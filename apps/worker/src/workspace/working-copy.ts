import { copyFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { hashSourceProject } from "../inspection/hash-source-project.js";
import { ensureWorkRoot, safeJoin, sessionWorkspacePath } from "./work-root.js";

/**
 * Deterministic working-copy lifecycle for EXECUTE_FRAME (CLAUDE.md Safety
 * Rule 1: "never overwrite the original .aep"). The destination path is
 * NEVER taken from caller/network input - it is always re-derived here
 * from (workRoot, executionSessionId), the same path-safety primitive
 * INSPECT_TEMPLATE/INSPECT_SCENE_EVIDENCE already trust (see
 * workspace/work-root.ts: safeJoin blocks traversal, sessionWorkspacePath
 * validates the id itself).
 *
 * Session-scoped (multi-scene-accumulation phase, section 3/4) rather than
 * job-scoped: EVERY scene's EXECUTE_FRAME job for the same
 * executionSessionId resolves to the SAME working copy file, so scene 2's
 * edit lands on top of scene 1's, never a fresh copy from the original
 * source. The FIRST job for a session creates it once (copy-once
 * semantics, `expectedWorkingProjectSha256: null`); every later job must
 * find it already there and matching the session's own durably-recorded
 * chain-of-custody head (`expectedWorkingProjectSha256`, non-null) - see
 * WORKING_COPY_MISSING/WORKING_COPY_SHA_MISMATCH below (section 6/7).
 */
const WORKING_COPY_FILENAME = "working-copy.aep";

export function sessionWorkingCopyPath(workRoot: string, executionSessionId: string): string {
  return safeJoin(sessionWorkspacePath(workRoot, executionSessionId), WORKING_COPY_FILENAME);
}

export interface PrepareSessionWorkingCopyParams {
  workRoot: string;
  executionSessionId: string;
  sourceProjectPath: string;
  expectedSourceSha256: string;
  /** Null only for a session's very first scene job (no working copy has ever been produced yet). Non-null for every later job - the session's own latestWorkingProjectSha256 as last durably recorded by the API. */
  expectedWorkingProjectSha256: string | null;
}

export interface WorkingCopyReady {
  ok: true;
  workingProjectPath: string;
  /** Re-verified now, from the real file on disk - never merely echoed back from the request. */
  sourceProjectSha256: string;
  workingProjectSha256: string;
  /** True when an existing, valid working copy was reused rather than freshly copied - the resume/accumulation path (section 2/4: "resume reuses existing valid working copy"). */
  resumed: boolean;
}

export type WorkingCopyFailureReason =
  | "SAME_PATH"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_SHA_MISMATCH"
  | "COPY_FAILED"
  | "WORKING_COPY_INVALID"
  /** expectedWorkingProjectSha256 was non-null (a prior scene already succeeded in this session) but no file exists at the session's derived path - section 7: "return explicit WORKING_COPY_MISSING". Never silently recreated from the original source. */
  | "WORKING_COPY_MISSING"
  /** A file exists, but its real sha256 does not match expectedWorkingProjectSha256 - the on-disk state has diverged from what the session's own durable record expects (section 6's chain-of-custody). Never silently overwritten. */
  | "WORKING_COPY_SHA_MISMATCH";

export interface WorkingCopyFailure {
  ok: false;
  reason: WorkingCopyFailureReason;
  message: string;
}

export type WorkingCopyResult = WorkingCopyReady | WorkingCopyFailure;

function hashOrFail(filePath: string, failReason: WorkingCopyFailureReason) {
  return hashSourceProject(filePath).then((result) =>
    result.ok
      ? { ok: true as const, sha256: result.value.sha256 }
      : { ok: false as const, reason: failReason, message: result.reason }
  );
}

/**
 * Verifies the source .aep still matches `expectedSourceSha256`, then:
 *   - if `expectedWorkingProjectSha256` is null (this session's first
 *     scene job): reuses an existing valid working copy if one is already
 *     there (a retried first-attempt - never re-copied over, so
 *     in-progress edits from that attempt are never discarded), otherwise
 *     creates a new one by copying the source into the session's own
 *     workspace directory - never the reverse, never in place.
 *   - if `expectedWorkingProjectSha256` is non-null (a later scene job):
 *     the working copy MUST already exist and its real sha256 MUST match
 *     exactly - WORKING_COPY_MISSING/WORKING_COPY_SHA_MISMATCH otherwise,
 *     never a silent recreation from the original source (section 6/7's
 *     chain-of-custody guarantee).
 *
 * The source is re-hashed a SECOND time immediately after a fresh copy
 * completes, to catch a source file that changed mid-copy (a race the
 * single before-copy check alone cannot detect) - if that happens, the
 * just-created working copy is left on disk (kept for forensic value,
 * matching this project's "never silently discard" convention elsewhere)
 * but the result is still reported as a failure, never a false success.
 */
export async function prepareSessionWorkingCopy(params: PrepareSessionWorkingCopyParams): Promise<WorkingCopyResult> {
  const destPath = sessionWorkingCopyPath(params.workRoot, params.executionSessionId);

  if (path.resolve(params.sourceProjectPath) === path.resolve(destPath)) {
    return {
      ok: false,
      reason: "SAME_PATH",
      message: `sourceProjectPath and the derived working copy path resolve to the same file (${destPath}) - refusing to treat the source as its own working copy`
    };
  }

  const sourceHashBefore = await hashOrFail(params.sourceProjectPath, "SOURCE_NOT_FOUND");
  if (!sourceHashBefore.ok) {
    return sourceHashBefore;
  }
  if (sourceHashBefore.sha256 !== params.expectedSourceSha256) {
    return {
      ok: false,
      reason: "SOURCE_SHA_MISMATCH",
      message: `source .aep sha256 (${sourceHashBefore.sha256}) does not match the expected sha256 (${params.expectedSourceSha256}) - the source project has changed since this job was created; refusing to proceed`
    };
  }

  if (params.expectedWorkingProjectSha256 !== null) {
    // A prior scene already succeeded in this session - the working copy
    // MUST already exist and match exactly. Never recreated from source.
    if (!existsSync(destPath)) {
      return {
        ok: false,
        reason: "WORKING_COPY_MISSING",
        message: `this session's working copy is expected to already exist at ${destPath} (a prior scene edit already succeeded) but no file was found - refusing to recreate it from the original source`
      };
    }
    const workingHash = await hashOrFail(destPath, "WORKING_COPY_INVALID");
    if (!workingHash.ok) {
      return workingHash;
    }
    if (workingHash.sha256 !== params.expectedWorkingProjectSha256) {
      return {
        ok: false,
        reason: "WORKING_COPY_SHA_MISMATCH",
        message: `working copy sha256 (${workingHash.sha256}) does not match this session's expected sha256 (${params.expectedWorkingProjectSha256}) - the on-disk state has diverged from what this session's own durable record expects`
      };
    }
    return {
      ok: true,
      workingProjectPath: destPath,
      sourceProjectSha256: sourceHashBefore.sha256,
      workingProjectSha256: workingHash.sha256,
      resumed: true
    };
  }

  if (existsSync(destPath)) {
    // First-scene resume path: an existing working copy from an earlier
    // attempt at THIS SAME first job is reused as-is, never re-copied over
    // - a re-copy here could silently discard in-progress edits a prior
    // attempt already made to it.
    let stat;
    try {
      stat = statSync(destPath);
    } catch (error) {
      return {
        ok: false,
        reason: "WORKING_COPY_INVALID",
        message: `existing working copy at ${destPath} could not be read: ${error instanceof Error ? error.message : String(error)}`
      };
    }
    if (!stat.isFile() || stat.size === 0) {
      return {
        ok: false,
        reason: "WORKING_COPY_INVALID",
        message: `existing working copy at ${destPath} is not a valid non-empty file`
      };
    }
    const workingHash = await hashOrFail(destPath, "WORKING_COPY_INVALID");
    if (!workingHash.ok) {
      return workingHash;
    }
    return {
      ok: true,
      workingProjectPath: destPath,
      sourceProjectSha256: sourceHashBefore.sha256,
      workingProjectSha256: workingHash.sha256,
      resumed: true
    };
  }

  ensureWorkRoot(path.dirname(destPath));

  try {
    copyFileSync(params.sourceProjectPath, destPath);
  } catch (error) {
    return {
      ok: false,
      reason: "COPY_FAILED",
      message: `could not copy ${params.sourceProjectPath} to ${destPath}: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  // Race detection: re-verify the SOURCE (not the copy) is still exactly
  // what it was before the copy started.
  const sourceHashAfter = await hashOrFail(params.sourceProjectPath, "SOURCE_NOT_FOUND");
  if (!sourceHashAfter.ok || sourceHashAfter.sha256 !== params.expectedSourceSha256) {
    return {
      ok: false,
      reason: "SOURCE_SHA_MISMATCH",
      message: "source .aep changed while it was being copied - refusing to treat the resulting working copy as trustworthy"
    };
  }

  const workingHash = await hashOrFail(destPath, "WORKING_COPY_INVALID");
  if (!workingHash.ok) {
    return workingHash;
  }

  return {
    ok: true,
    workingProjectPath: destPath,
    sourceProjectSha256: sourceHashBefore.sha256,
    workingProjectSha256: workingHash.sha256,
    resumed: false
  };
}
