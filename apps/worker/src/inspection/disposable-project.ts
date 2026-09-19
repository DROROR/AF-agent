import { randomUUID } from "node:crypto";
import { closeSync, openSync, renameSync, unlinkSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import type pino from "pino";
import type {
  CleanupOutcome,
  DisposableInspectionEvidence,
  DisposableInspectionFailureCode,
  PriorAeProjectState,
  RestorationOutcome
} from "@dyo/schemas";
import {
  buildCloseDisposableProjectScript,
  buildDescribeMissingFootageScript,
  buildDescribeOpenProjectStateScript,
  buildOpenProjectScript,
  type FixedJsxScript
} from "../execution/jsx-templates.js";
import { canonicalizeWindowsPath, windowsPathsEqual } from "./canonical-windows-path.js";
import { hashSourceProject } from "./hash-source-project.js";
import { workerProjectStateLock, type ProjectStateLock } from "./project-state-lock.js";

/**
 * THE ONE SAFE-INSPECTION WRAPPER (Stage 3, 2026-09-19).
 *
 * EVERY inspection that opens an After Effects project goes through here. The
 * immutable source .aep and a session working copy are NEVER opened directly:
 * this makes a uniquely-named disposable copy, opens that, and disposes of it.
 *
 * WHY BESIDE THE ORIGINAL: a template's footage is routinely referenced by
 * RELATIVE path. A copy in some scratch directory would resolve those paths
 * against the wrong base and report missing footage that the real project
 * resolves perfectly - misleading evidence, which is worse than no evidence.
 * The copy therefore lives in the SAME directory as the file it copies, and
 * the footage check afterwards proves the resolution actually held.
 *
 * WHAT IT REFUSES TO TOUCH: whatever After Effects already holds. If that
 * project is dirty, untitled, or its state cannot be positively verified (an
 * AE build with no reliable dirty-state API), this refuses the inspection
 * rather than risk discarding a human's unsaved work. It never answers a Save
 * Changes prompt, and it only ever closes with DO_NOT_SAVE_CHANGES after
 * proving the open project IS this operation's own copy.
 *
 * WHAT IT PROVES AFTERWARDS: the immutable source and the working copy are
 * hashed before and after. Any change is a safety violation and fails the
 * inspection closed, whatever the inspection itself returned.
 */

export type RunScript = (script: FixedJsxScript, timeoutMs?: number) => Promise<{ ok: true; value: unknown } | { ok: false; reason: string }>;

export interface DisposableProjectDeps {
  /** Runs one fixed, allowlisted script against After Effects and unwraps its JSON result. */
  runScript: RunScript;
  /**
   * Runs the OPEN script specifically. Defaults to `runScript`, but a caller
   * whose `runScript` retries transient failures MUST supply a non-retrying
   * one here: re-issuing `app.open()` after a timeout is the real 2026-09-03
   * incident (MCP/stdio has no cancellation, so the abandoned open may still
   * be running). Exactly one open attempt is ever made; a timeout is resolved
   * by polling instead - see `pollForOpenedPath`.
   */
  runOpenScript?: RunScript | undefined;
  lock?: ProjectStateLock | undefined;
  now?: (() => Date) | undefined;
  logger?: pino.Logger | undefined;
  /** Injectable purely for failure-injection tests; production uses the real filesystem. */
  fileOps?: FileOps | undefined;
  /**
   * Optional poll-not-reopen fallback, preserving the real 2026-09-03 incident
   * fix: `app.open()` can genuinely exceed an MCP call timeout while still
   * completing, and re-issuing it is what left After Effects wedged. When the
   * single open attempt comes back as a failure, this is asked (read-only,
   * bounded by its own implementation) whether the expected project became
   * open on its own. A second open is NEVER attempted.
   */
  pollForOpenedPath?: ((expectedPath: string) => Promise<{ matched: boolean; actualOpenedPath: string | null; note?: string }>) | undefined;
  /** How long one app.open call may take before it is treated as timed out. Callers with their own tuned open budget (the template inspector) pass theirs; otherwise OPEN_TIMEOUT_MS applies. */
  openTimeoutMs?: number | undefined;
}

export interface FileOps {
  copy(from: string, to: string): Promise<void>;
  /** Proves the directory is writable by actually creating and removing a file in it - never by inspecting permission bits. */
  assertDirectoryWritable(directory: string): Promise<void>;
  remove(filePath: string): Promise<void>;
  /** Renames a file that could not be deleted, so a human sees exactly one quarantined artefact. */
  quarantine(filePath: string): Promise<string>;
  hash(filePath: string): Promise<{ ok: true; sha256: string } | { ok: false; reason: string }>;
}

export interface DisposableProjectRequest {
  /** For evidence and logs, e.g. "INSPECT_TEMPLATE". */
  operation: string;
  /** The file to inspect. Never opened itself - a copy of it is. */
  targetPath: string;
  targetSha256: string;
  /** The immutable source .aep, hashed before and after as a safety check. Equal to targetPath when the source itself is what is being inspected. */
  sourceProjectPath: string;
  sourceProjectSha256: string;
  /** The session working copy, when this inspection concerns one - hashed before and after the same way. */
  workingProjectPath?: string | null;
  workingProjectSha256?: string | null;
}

export interface DisposableProjectContext {
  /** The copy to inspect. Every script the inspection runs must target THIS path, never the original. */
  disposablePath: string;
}

export type DisposableProjectResult<T> =
  | { ok: true; value: T; evidence: DisposableInspectionEvidence }
  | { ok: false; code: DisposableInspectionFailureCode; reason: string; evidence: DisposableInspectionEvidence };

/** Timeout for opening a project - app.open on a large template genuinely takes longer than an ordinary read-only call. */
const OPEN_TIMEOUT_MS = 120_000;

/** The marker every disposable copy's filename carries. Stale-copy recovery only ever considers a file whose name contains it, so nothing else can be swept up. */
export const DISPOSABLE_FILENAME_MARKER = ".dyo-inspect-";

/** A copy that could not be deleted is renamed with this suffix - visible, inert, and never matched as a disposable copy again. */
export const QUARANTINE_SUFFIX = ".quarantine";

/**
 * Windows paths and POSIX paths need different separator rules, and getting it
 * wrong silently rewrites the path (a POSIX "/tmp/x.aep" handled as a Windows
 * path becomes "\tmp\x.aep", which is a different file). The worker runs on
 * Windows; tests and development do not - so the shape of the path itself
 * decides, never the host platform.
 */
function pathApiFor(target: string): path.PlatformPath {
  return /^[a-zA-Z]:[\\/]/.test(target) || target.includes("\\") ? path.win32 : path.posix;
}

/** The directory the disposable copy must live in - the same one as the file it copies, so relative footage resolves identically. */
export function targetDirectoryFor(targetPath: string): string {
  return pathApiFor(targetPath).dirname(targetPath);
}

export function disposableCopyPathFor(targetPath: string, id: string = randomUUID()): string {
  const api = pathApiFor(targetPath);
  const directory = api.dirname(targetPath);
  const base = api.basename(targetPath, api.extname(targetPath));
  return api.join(directory, `${base}${DISPOSABLE_FILENAME_MARKER}${id}.aep`);
}

/** True only for a path this wrapper itself would have created - the sole basis for any stale-copy recovery. */
export function isDisposableCopyPath(candidate: string): boolean {
  const base = pathApiFor(candidate).basename(candidate).toLowerCase();
  return base.includes(DISPOSABLE_FILENAME_MARKER) && base.endsWith(".aep");
}

const realFileOps: FileOps = {
  async copy(from, to) {
    await copyFile(from, to);
  },
  async assertDirectoryWritable(directory) {
    const probe = pathApiFor(directory).join(directory, `${DISPOSABLE_FILENAME_MARKER}writable-${randomUUID()}.tmp`);
    // "wx" fails if the file exists, so this can never overwrite anything.
    const handle = openSync(probe, "wx");
    closeSync(handle);
    unlinkSync(probe);
  },
  async remove(filePath) {
    unlinkSync(filePath);
  },
  async quarantine(filePath) {
    const quarantined = `${filePath}${QUARANTINE_SUFFIX}`;
    renameSync(filePath, quarantined);
    return quarantined;
  },
  async hash(filePath) {
    const result = await hashSourceProject(filePath);
    return result.ok ? { ok: true, sha256: result.value.sha256 } : { ok: false, reason: result.reason };
  }
};

/** What buildDescribeOpenProjectStateScript reports. Parsed defensively - an unreadable state is "unknown", never "safe". */
function parseProjectState(value: unknown): (PriorAeProjectState & { dirtyAvailable: boolean }) | null {
  const outer = value as { resultingValue?: unknown } | null;
  const inner = (outer?.resultingValue ?? value) as Record<string, unknown> | null;
  if (inner === null || typeof inner !== "object") {
    return null;
  }
  const projectOpen = inner.projectOpen;
  const dirtyAvailable = inner.dirtyAvailable;
  if (typeof projectOpen !== "boolean" || typeof dirtyAvailable !== "boolean") {
    return null;
  }
  return {
    projectOpen,
    projectPath: typeof inner.projectPath === "string" ? inner.projectPath : null,
    projectName: typeof inner.projectName === "string" ? inner.projectName : null,
    dirty: typeof inner.dirty === "boolean" ? inner.dirty : null,
    itemCount: typeof inner.itemCount === "number" ? inner.itemCount : null,
    dirtyAvailable
  };
}

function parseOpenedPath(value: unknown): string | null | undefined {
  const outer = value as { ok?: unknown; resultingValue?: unknown } | null;
  if (outer === null || typeof outer !== "object") {
    return undefined;
  }
  const inner = outer.resultingValue as { openedPath?: unknown } | undefined;
  if (inner === undefined || typeof inner !== "object" || inner === null) {
    return undefined;
  }
  return typeof inner.openedPath === "string" ? inner.openedPath : null;
}

function parseMissingFootage(value: unknown): string[] | null {
  const outer = value as { resultingValue?: unknown } | null;
  const inner = (outer?.resultingValue ?? value) as { missing?: unknown } | null;
  if (inner === null || typeof inner !== "object" || !Array.isArray(inner.missing)) {
    return null;
  }
  return inner.missing.map((entry) => {
    const item = entry as { name?: unknown; path?: unknown };
    const name = typeof item.name === "string" ? item.name : "unnamed footage item";
    return typeof item.path === "string" ? `${name} (${item.path})` : name;
  });
}

/**
 * Runs `inspect` against a disposable copy of `request.targetPath`.
 *
 * Every stage is wrapped so that closing, restoring and cleaning up happen
 * whatever the inspection did - including throwing.
 */
export async function withDisposableProject<T>(
  deps: DisposableProjectDeps,
  request: DisposableProjectRequest,
  inspect: (context: DisposableProjectContext) => Promise<T>
): Promise<DisposableProjectResult<T>> {
  const now = deps.now ?? (() => new Date());
  const fileOps = deps.fileOps ?? realFileOps;
  const lock = deps.lock ?? workerProjectStateLock;
  const startedAt = now().toISOString();

  const evidence: DisposableInspectionEvidence = {
    operation: request.operation,
    targetPath: request.targetPath,
    targetExpectedSha256: request.targetSha256,
    targetActualSha256: null,
    disposablePath: null,
    disposableSha256: null,
    sourceProjectPath: request.sourceProjectPath,
    sourceSha256Before: null,
    sourceSha256After: null,
    workingProjectPath: request.workingProjectPath ?? null,
    workingSha256Before: null,
    workingSha256After: null,
    priorAeProjectState: null,
    restoration: "NOT_DISTURBED",
    restorationNote: null,
    cleanup: "NOTHING_TO_CLEAN",
    cleanupNote: null,
    unresolvedFootage: [],
    startedAt,
    completedAt: startedAt
  };

  // Returns the LIVE evidence object, never a copy: the finally block below
  // records closing, restoration and cleanup after this point, and a refusal
  // is exactly when an operator most needs to see how things were left.
  const fail = (code: DisposableInspectionFailureCode, reason: string): DisposableProjectResult<T> => ({ ok: false, code, reason, evidence });

  const acquired = lock.acquire(request.operation);
  if (!acquired.ok) {
    return fail("BUSY", `another project operation (${acquired.heldBy}, since ${acquired.heldSince.toISOString()}) is already using After Effects - refusing to change the open project underneath it`);
  }

  let disposablePath: string | null = null;
  let disposableMayStillBeOpen = false;
  let priorProjectToRestore: string | null = null;

  try {
    // 1. HASH EVERY PROTECTED FILE FIRST - before anything is copied, opened
    //    or changed, so "unchanged afterwards" means something.
    const sourceBefore = await fileOps.hash(request.sourceProjectPath);
    if (!sourceBefore.ok) {
      return fail("PROTECTED_FILE_CHANGED", `the immutable source .aep could not be hashed before inspecting (${sourceBefore.reason})`);
    }
    evidence.sourceSha256Before = sourceBefore.sha256;
    if (sourceBefore.sha256 !== request.sourceProjectSha256) {
      return fail("PROTECTED_FILE_CHANGED", `the immutable source .aep no longer matches its expected sha256 (expected ${request.sourceProjectSha256}, found ${sourceBefore.sha256})`);
    }
    if (request.workingProjectPath) {
      const workingBefore = await fileOps.hash(request.workingProjectPath);
      if (!workingBefore.ok) {
        return fail("PROTECTED_FILE_CHANGED", `the session working copy could not be hashed before inspecting (${workingBefore.reason})`);
      }
      evidence.workingSha256Before = workingBefore.sha256;
      if (request.workingProjectSha256 && workingBefore.sha256 !== request.workingProjectSha256) {
        return fail("PROTECTED_FILE_CHANGED", `the session working copy no longer matches its expected sha256 (expected ${request.workingProjectSha256}, found ${workingBefore.sha256})`);
      }
    }

    // 2. THE FILE TO INSPECT must be exactly what the caller thinks it is.
    const targetHash = windowsPathsEqual(request.targetPath, request.sourceProjectPath)
      ? { ok: true as const, sha256: sourceBefore.sha256 }
      : await fileOps.hash(request.targetPath);
    if (!targetHash.ok) {
      return fail("TARGET_HASH_MISMATCH", `the file to inspect could not be hashed (${targetHash.reason})`);
    }
    evidence.targetActualSha256 = targetHash.sha256;
    if (targetHash.sha256 !== request.targetSha256) {
      return fail("TARGET_HASH_MISMATCH", `the file to inspect does not match its expected sha256 (expected ${request.targetSha256}, found ${targetHash.sha256})`);
    }

    // 3. THE COPY LIVES BESIDE THE ORIGINAL, so relative footage keeps the
    //    same base directory. If that directory is not writable, stop now -
    //    before After Effects is involved at all.
    const targetDirectory = targetDirectoryFor(request.targetPath);
    try {
      await fileOps.assertDirectoryWritable(targetDirectory);
    } catch (error) {
      return fail(
        "TARGET_DIRECTORY_NOT_WRITABLE",
        `the directory holding the file to inspect (${targetDirectory}) is not writable, so a copy preserving relative footage paths cannot be made: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const candidatePath = disposableCopyPathFor(request.targetPath);
    try {
      await fileOps.copy(request.targetPath, candidatePath);
    } catch (error) {
      return fail("COPY_FAILED", `the disposable copy could not be created: ${error instanceof Error ? error.message : String(error)}`);
    }
    disposablePath = candidatePath;
    evidence.disposablePath = candidatePath;
    evidence.cleanup = "CLEANUP_FAILED"; // Corrected in the finally block; never left claiming success.

    const disposableHash = await fileOps.hash(candidatePath);
    if (!disposableHash.ok) {
      return fail("COPY_FAILED", `the disposable copy could not be hashed (${disposableHash.reason})`);
    }
    evidence.disposableSha256 = disposableHash.sha256;
    if (disposableHash.sha256 !== targetHash.sha256) {
      return fail("COPY_FAILED", `the disposable copy does not match the file it was copied from (expected ${targetHash.sha256}, found ${disposableHash.sha256})`);
    }

    // 4. WHAT AE ALREADY HOLDS decides whether this may proceed at all.
    const stateResult = await deps.runScript(buildDescribeOpenProjectStateScript());
    if (!stateResult.ok) {
      return fail("AE_STATE_UNKNOWN", `After Effects' current project state could not be read (${stateResult.reason}) - refusing to replace a project whose state is unknown`);
    }
    const state = parseProjectState(stateResult.value);
    if (state === null) {
      return fail("AE_STATE_UNKNOWN", "After Effects' current project state could not be interpreted - refusing to replace a project whose state is unknown");
    }
    const { dirtyAvailable, ...priorState } = state;
    evidence.priorAeProjectState = priorState;

    if (priorState.projectOpen) {
      if (isDisposableCopyPath(priorState.projectPath ?? "")) {
        // A copy from an earlier operation of THIS wrapper: inert by
        // definition, safe to replace, and never restored afterwards.
        priorProjectToRestore = null;
      } else if (!dirtyAvailable) {
        return fail(
          "AE_PROJECT_NOT_SAFE_TO_REPLACE",
          "After Effects is holding a project but exposes no reliable unsaved-changes flag on this build, so it cannot be proven safe to replace - close the project in After Effects yourself, then retry"
        );
      } else if (priorState.dirty === true) {
        return fail(
          "AE_PROJECT_NOT_SAFE_TO_REPLACE",
          `After Effects is holding unsaved changes in "${priorState.projectName ?? "an untitled project"}" - refusing to touch it, because only you can decide whether that work is kept; save or close it in After Effects, then retry`
        );
      } else if (priorState.projectPath === null) {
        return fail(
          "AE_PROJECT_NOT_SAFE_TO_REPLACE",
          "After Effects is holding an untitled project that has never been saved - refusing to replace it; close it in After Effects yourself, then retry"
        );
      } else {
        // A saved, verified-clean project: it may be replaced, and it will be
        // reopened and identity-checked afterwards.
        priorProjectToRestore = priorState.projectPath;
      }
    }

    // 5. OPEN THE COPY - never the original.
    disposableMayStillBeOpen = true;
    const openScriptRunner = deps.runOpenScript ?? deps.runScript;
    const openResult = await openScriptRunner(buildOpenProjectScript(candidatePath), deps.openTimeoutMs ?? OPEN_TIMEOUT_MS);
    let openedPath: string | null | undefined;
    if (openResult.ok) {
      openedPath = parseOpenedPath(openResult.value);
      if (openedPath === undefined) {
        return fail("OPEN_FAILED", "the open-project script's response did not match the expected shape");
      }
    } else if (deps.pollForOpenedPath) {
      // Poll-not-reopen: ask (read-only) whether it opened anyway. Never a
      // second app.open().
      const polled = await deps.pollForOpenedPath(candidatePath);
      if (!polled.matched) {
        return fail(
          "OPEN_FAILED",
          `the disposable copy could not be opened (${openResult.reason}), and it never appeared as the open project within the polling budget${polled.note ? ` (${polled.note})` : ""}`
        );
      }
      openedPath = polled.actualOpenedPath;
    } else {
      return fail("OPEN_FAILED", `the disposable copy could not be opened (${openResult.reason})`);
    }
    if (openedPath === null) {
      // REAL 2026-09-11 SIGNATURE: app.open() did not throw, yet After Effects
      // ended up with NO project associated at all. That is what a project
      // needing an interactive one-time confirmation looks like (a version
      // conversion, or an unacknowledged missing-font/plugin warning) - the
      // very dialogs `app.beginSuppressDialogs()` prevents from appearing.
      // Never asserted as file corruption: a human must confirm which it is,
      // by opening the file in After Effects themselves once.
      return fail(
        "OPEN_FAILED",
        "After Effects accepted the open but ended up with no project associated - this is what a project requiring an interactive one-time confirmation in After Effects looks like (a version conversion, or an unacknowledged missing-font/plugin warning), never automatic file corruption. Open the project in After Effects yourself once, confirm whatever it asks, then retry this inspection"
      );
    }
    if (!windowsPathsEqual(openedPath, candidatePath)) {
      return fail("OPEN_FAILED", `After Effects reports "${openedPath}" is open, not this operation's disposable copy`);
    }

    // 6. PROVE RELATIVE FOOTAGE STILL RESOLVES, rather than assuming the
    //    copy's location preserved it.
    const footageResult = await deps.runScript(buildDescribeMissingFootageScript());
    if (!footageResult.ok) {
      return fail("FOOTAGE_UNRESOLVED", `footage resolution in the disposable copy could not be checked (${footageResult.reason})`);
    }
    const missing = parseMissingFootage(footageResult.value);
    if (missing === null) {
      return fail("FOOTAGE_UNRESOLVED", "the footage-resolution check's response did not match the expected shape");
    }
    evidence.unresolvedFootage = missing;
    if (missing.length > 0) {
      return fail(
        "FOOTAGE_UNRESOLVED",
        `the disposable copy cannot resolve ${missing.length} footage item(s) (${missing.slice(0, 5).join(", ")}) - refusing to report inspection evidence that would describe a project missing content the original has`
      );
    }

    // 7. THE INSPECTION ITSELF.
    let value: T;
    try {
      value = await inspect({ disposablePath: candidatePath });
    } catch (error) {
      return fail("INSPECTION_FAILED", `the inspection failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 8. NOTHING PROTECTED MAY HAVE CHANGED. Checked after the inspection
    //    body, before its result is trusted.
    const sourceAfter = await fileOps.hash(request.sourceProjectPath);
    evidence.sourceSha256After = sourceAfter.ok ? sourceAfter.sha256 : null;
    if (!sourceAfter.ok || sourceAfter.sha256 !== sourceBefore.sha256) {
      return fail(
        "PROTECTED_FILE_CHANGED",
        sourceAfter.ok
          ? `the immutable source .aep changed during this inspection (${sourceBefore.sha256} -> ${sourceAfter.sha256}) - safety violation`
          : `the immutable source .aep could not be re-hashed after the inspection (${sourceAfter.reason})`
      );
    }
    if (request.workingProjectPath) {
      const workingAfter = await fileOps.hash(request.workingProjectPath);
      evidence.workingSha256After = workingAfter.ok ? workingAfter.sha256 : null;
      if (!workingAfter.ok || workingAfter.sha256 !== evidence.workingSha256Before) {
        return fail(
          "PROTECTED_FILE_CHANGED",
          workingAfter.ok
            ? `the session working copy changed during this inspection (${evidence.workingSha256Before ?? "unknown"} -> ${workingAfter.sha256}) - safety violation`
            : `the session working copy could not be re-hashed after the inspection (${workingAfter.reason})`
        );
      }
    }

    return { ok: true, value, evidence };
  } finally {
    // CLOSE, RESTORE, CLEAN UP - whatever happened above, including a throw.
    if (disposablePath !== null && disposableMayStillBeOpen) {
      const closeResult = await deps.runScript(buildCloseDisposableProjectScript(disposablePath));
      if (closeResult.ok) {
        disposableMayStillBeOpen = false;
      } else {
        deps.logger?.warn({ disposablePath, reason: closeResult.reason }, "could not close the disposable copy - leaving it on disk rather than deleting a file After Effects may still hold");
      }
    }

    if (priorProjectToRestore !== null) {
      const restoreResult = await (deps.runOpenScript ?? deps.runScript)(buildOpenProjectScript(priorProjectToRestore), deps.openTimeoutMs ?? OPEN_TIMEOUT_MS);
      const restoredPath = restoreResult.ok ? parseOpenedPath(restoreResult.value) : undefined;
      if (restoreResult.ok && restoredPath !== undefined && windowsPathsEqual(restoredPath, priorProjectToRestore)) {
        evidence.restoration = "RESTORED";
      } else {
        evidence.restoration = "RESTORE_FAILED";
        evidence.restorationNote = restoreResult.ok
          ? `After Effects reports "${restoredPath ?? "no project"}" is open, not the project it held before this inspection (${priorProjectToRestore})`
          : `the project After Effects held before this inspection (${priorProjectToRestore}) could not be reopened: ${restoreResult.reason}`;
        deps.logger?.warn({ priorProjectToRestore, note: evidence.restorationNote }, "could not restore the project After Effects held before this inspection");
      }
    } else if (evidence.priorAeProjectState?.projectOpen !== true) {
      evidence.restoration = "NOTHING_TO_RESTORE";
    }

    if (disposablePath === null) {
      evidence.cleanup = "NOTHING_TO_CLEAN";
    } else if (disposableMayStillBeOpen) {
      // Deleting a file After Effects may still hold is how a half-written
      // project or a locked handle happens. Leave it, and say exactly which.
      evidence.cleanup = "LEFT_IN_PLACE_STILL_OPEN";
      evidence.cleanupNote = `the disposable copy could not be proven closed, so it was left at ${disposablePath} rather than deleted underneath After Effects`;
    } else {
      try {
        await fileOps.remove(disposablePath);
        evidence.cleanup = "DELETED";
      } catch (removeError) {
        try {
          const quarantined = await fileOps.quarantine(disposablePath);
          evidence.cleanup = "QUARANTINED";
          evidence.cleanupNote = `the disposable copy could not be deleted (${removeError instanceof Error ? removeError.message : String(removeError)}) and was renamed to ${quarantined} for you to remove`;
        } catch (quarantineError) {
          evidence.cleanup = "CLEANUP_FAILED";
          evidence.cleanupNote = `the disposable copy at ${disposablePath} could not be deleted (${removeError instanceof Error ? removeError.message : String(removeError)}) or renamed aside (${quarantineError instanceof Error ? quarantineError.message : String(quarantineError)}) - remove it yourself`;
        }
        deps.logger?.warn({ disposablePath, cleanup: evidence.cleanup, note: evidence.cleanupNote }, "disposable copy cleanup did not complete");
      }
    }

    evidence.completedAt = now().toISOString();
    acquired.handle.release();
  }
}

/**
 * Lists leftover disposable copies in one directory - REPORTING ONLY.
 *
 * Deliberately never deletes: a wildcard sweep over a directory that holds the
 * client's own template is exactly the kind of cleanup that removes the wrong
 * file once. Every candidate must satisfy `isDisposableCopyPath`, so nothing
 * this wrapper did not create can ever be listed, and an operator (or a
 * diagnostic) decides what to do with what comes back.
 */
export function findStaleDisposableCopies(directory: string, entries: readonly string[]): string[] {
  const api = pathApiFor(directory);
  return entries.filter((entry) => isDisposableCopyPath(entry)).map((entry) => api.join(directory, api.basename(entry)));
}

/** Canonical form used when comparing any path this wrapper handles - see canonical-windows-path.ts for the casing/separator rules. */
export function canonicalPath(value: string): string {
  return canonicalizeWindowsPath(value);
}
