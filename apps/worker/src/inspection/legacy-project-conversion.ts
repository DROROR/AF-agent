import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statfsSync, statSync } from "node:fs";
import path from "node:path";
import { ensureWorkRoot, safeJoin } from "../workspace/work-root.js";
import { hashSourceProject } from "./hash-source-project.js";

/**
 * Real 2026-09-11 incident: a template that requires an interactive AE-level
 * confirmation to open (most commonly a version-conversion prompt, but also
 * an unacknowledged missing-font/plugin warning) cannot be opened via a
 * suppressed-dialogs `app.open()` call at all - AE returns without throwing,
 * but ends up with no project loaded. There is no documented ExtendScript
 * API to script past a REQUIRED interactive AE dialog, so a human must open
 * the file once, respond, and save the result.
 *
 * What IS safely automatable, and what this module does: derive a
 * DETERMINISTIC destination for a disposable copy, keyed by the source's own
 * real sha256 (never its path or name), and create that copy without ever
 * opening or modifying the original.
 *
 * REAL 2026-09-12 FOLLOW-UP - why the whole package is copied, not just the
 * .aep: the first version copied ONLY the project file into a bare
 * conversion directory. That orphaned it from the sibling asset folder its
 * footage lives in (a Mixkit template's own `(Footage)` directory), and the
 * resulting inspection reported 17 MISSING FOOTAGE items purely as an
 * artefact of where this worker had put the copy. A conversion copy must
 * preserve the template's own relative layout or it is not a faithful copy
 * of the template at all.
 */

/** Bounds so a project sitting loose in a large shared folder can never trigger a runaway copy. Exceeding either is reported honestly, never silently truncated. */
export const MAX_PACKAGE_FILES = 5_000;
export const MAX_PACKAGE_BYTES = 8 * 1024 * 1024 * 1024;
/** Headroom left free after a package copy - never fill the disk to the last byte, which would break everything else on the machine. */
export const FREE_SPACE_MARGIN_BYTES = 2 * 1024 * 1024 * 1024;

/** Available bytes on the volume holding `dir`, or null when it cannot be determined (never guessed). */
function availableBytes(dir: string): number | null {
  try {
    const stats = statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

export function conversionCopyDirectory(workRoot: string, sourceSha256: string): string {
  return safeJoin(workRoot, "template-conversions", sourceSha256);
}

export interface PrepareConversionCopyParams {
  workRoot: string;
  sourceProjectPath: string;
  /** Overridable only so a test can demand more headroom than any machine has free, and exercise the real shortfall path. */
  freeSpaceMarginBytes?: number;
}

export type ConversionCopyResult =
  | {
      ok: true;
      sourceSha256: string;
      /** The .aep to open/convert - inside the copied package when the package was preserved. */
      conversionCopyPath: string;
      alreadyExisted: boolean;
      /** False when only the .aep itself could be copied, so relative footage will NOT resolve - the caller must say so rather than let a resulting "missing footage" count look like a fact about the template. */
      packagePreserved: boolean;
      /** Why the package could not be preserved, when packagePreserved is false. */
      packageNote: string | null;
    }
  | { ok: false; reason: string };

interface PackageSize {
  files: number;
  bytes: number;
}

/** Bounded walk - stops as soon as either limit is exceeded rather than sizing an arbitrarily large tree. */
function measureDirectory(dir: string): PackageSize | "too-large" {
  let files = 0;
  let bytes = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        bytes += statSync(full).size;
      } catch {
        continue;
      }
      files += 1;
      if (files > MAX_PACKAGE_FILES || bytes > MAX_PACKAGE_BYTES) {
        return "too-large";
      }
    }
  }
  return { files, bytes };
}

/**
 * Copies the source project's WHOLE containing folder (its template
 * package) into a deterministic, sha256-keyed location, preserving the
 * relative layout its footage depends on, and returns the path of the
 * project file inside that copy.
 *
 * Falls back to copying just the .aep - reporting packagePreserved: false
 * and why - when the containing folder is too large to copy safely. Never
 * overwrites an existing copy: a human may already be part-way through
 * converting and saving it.
 */
export async function prepareConversionCopy(params: PrepareConversionCopyParams): Promise<ConversionCopyResult> {
  const sourceHash = await hashSourceProject(params.sourceProjectPath);
  if (!sourceHash.ok) {
    return { ok: false, reason: `could not hash the source project to derive a conversion-copy path: ${sourceHash.reason}` };
  }

  const destDir = conversionCopyDirectory(params.workRoot, sourceHash.value.sha256);
  const sourceDir = path.dirname(params.sourceProjectPath);
  const baseName = path.basename(params.sourceProjectPath);
  const packageDest = path.join(destDir, "package");
  const packageProjectPath = path.join(packageDest, baseName);
  const bareProjectPath = path.join(destDir, "converted.aep");

  // Copy-once: an existing copy is reused untouched, whichever layout it used.
  if (existsSync(packageProjectPath)) {
    return {
      ok: true,
      sourceSha256: sourceHash.value.sha256,
      conversionCopyPath: packageProjectPath,
      alreadyExisted: true,
      packagePreserved: true,
      packageNote: null
    };
  }

  // The destination must never live inside the folder being copied, or the
  // copy would recurse into its own output. Real possibility here: work root
  // and template folders can share a parent (C:\DYO-Agent\...), so this is
  // a genuine configuration, not a theoretical one.
  const resolvedSourceDir = path.resolve(sourceDir);
  const resolvedDestDir = path.resolve(destDir);
  const destInsideSource =
    resolvedDestDir === resolvedSourceDir || resolvedDestDir.startsWith(resolvedSourceDir + path.sep);

  const measured = destInsideSource ? "too-large" : measureDirectory(sourceDir);

  // REAL 2026-09-12 FAILURE: a template whose (Footage)\Pre-renders folder
  // was larger than the free space on C: filled the disk mid-copy and failed
  // with EINPROGRESS/"There is not enough space on the disk", leaving a
  // partial package behind consuming even more of it. Size alone was bounded;
  // ACTUAL FREE SPACE never was. Checked up front now, and the shortfall is
  // reported in real numbers rather than as a bare copy error.
  let insufficientSpaceNote: string | null = null;
  if (measured !== "too-large") {
    ensureWorkRoot(destDir);
    const free = availableBytes(destDir);
    const margin = params.freeSpaceMarginBytes ?? FREE_SPACE_MARGIN_BYTES;
    const needed = measured.bytes + margin;
    if (free !== null && free < needed) {
      const gb = (bytes: number): string => (bytes / (1024 * 1024 * 1024)).toFixed(1);
      insufficientSpaceNote =
        `this template's folder needs ${gb(measured.bytes)}GB (plus ${gb(margin)}GB headroom) but only ` +
        `${gb(free)}GB is free on the drive holding this worker's work root, so only the project file itself was copied - ` +
        "any footage it references by relative path will NOT resolve from this copy";
    }
  }

  if (measured === "too-large" || insufficientSpaceNote !== null) {
    ensureWorkRoot(destDir);
    try {
      copyFileSync(params.sourceProjectPath, bareProjectPath);
    } catch (error) {
      return { ok: false, reason: `could not create a disposable copy at ${bareProjectPath}: ${error instanceof Error ? error.message : String(error)}` };
    }
    return {
      ok: true,
      sourceSha256: sourceHash.value.sha256,
      conversionCopyPath: bareProjectPath,
      alreadyExisted: false,
      packagePreserved: false,
      packageNote: insufficientSpaceNote
        ? insufficientSpaceNote
        : destInsideSource
        ? "this worker's own conversion folder lives inside the template's folder, so copying the whole package " +
          "would copy the destination into itself - only the project file itself was copied, and any footage it " +
          "references by relative path will NOT resolve from this copy"
        : `the folder containing this project exceeds the safe copy limit (${MAX_PACKAGE_FILES} files / ` +
          `${Math.round(MAX_PACKAGE_BYTES / (1024 * 1024 * 1024))}GB), so only the project file itself was copied - ` +
          "any footage it references by relative path will NOT resolve from this copy"
    };
  }

  mkdirSync(packageDest, { recursive: true });
  try {
    cpSync(sourceDir, packageDest, { recursive: true });
  } catch (error) {
    // A failed package copy leaves a PARTIAL tree behind, still consuming the
    // very disk space that most likely caused the failure. Clean it up, then
    // degrade to an .aep-only copy so the operator still has something to
    // convert - with the reason stated, so a resulting "missing footage"
    // count is never mistaken for a fact about the template.
    try {
      rmSync(packageDest, { recursive: true, force: true });
    } catch {
      // Best effort - never turn cleanup failure into the reported cause.
    }
    const reason = error instanceof Error ? error.message : String(error);
    try {
      copyFileSync(params.sourceProjectPath, bareProjectPath);
    } catch (fallbackError) {
      return {
        ok: false,
        reason:
          `could not copy the template package to ${packageDest} (${reason}), and the .aep-only fallback also failed: ` +
          `${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
      };
    }
    return {
      ok: true,
      sourceSha256: sourceHash.value.sha256,
      conversionCopyPath: bareProjectPath,
      alreadyExisted: false,
      packagePreserved: false,
      packageNote:
        `copying the whole template folder failed (${reason}), so only the project file itself was copied and any ` +
        "footage it references by relative path will NOT resolve from this copy - the partial copy was removed"
    };
  }
  if (!existsSync(packageProjectPath)) {
    return { ok: false, reason: `the template package was copied but ${baseName} is not present at ${packageProjectPath}` };
  }

  // MIGRATION (2026-09-12): an earlier build of this module copied ONLY the
  // .aep, to <dir>/converted.aep. A human may already have opened THAT file,
  // answered its conversion dialog and saved it - real work that must not be
  // thrown away just because this module now prefers a package layout. If
  // such a legacy copy exists, it is moved into the freshly-built package in
  // place of the unconverted project file, so the conversion is preserved AND
  // the footage now sits beside it. Without this, the legacy copy was
  // returned forever and the package was never built at all.
  let migratedNote: string | null = null;
  if (existsSync(bareProjectPath)) {
    try {
      copyFileSync(bareProjectPath, packageProjectPath);
      migratedNote =
        "an earlier .aep-only conversion copy was found and has been carried into this package, " +
        "so a conversion already performed by hand is preserved rather than being repeated";
    } catch {
      // The package's own (unconverted) copy of the project stays in place -
      // the human simply converts once more. Never fails the whole operation.
      migratedNote = null;
    }
  }

  return {
    ok: true,
    sourceSha256: sourceHash.value.sha256,
    conversionCopyPath: packageProjectPath,
    alreadyExisted: false,
    packagePreserved: true,
    packageNote: migratedNote
  };
}
