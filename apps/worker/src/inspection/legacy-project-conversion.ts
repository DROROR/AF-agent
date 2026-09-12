import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
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

export function conversionCopyDirectory(workRoot: string, sourceSha256: string): string {
  return safeJoin(workRoot, "template-conversions", sourceSha256);
}

export interface PrepareConversionCopyParams {
  workRoot: string;
  sourceProjectPath: string;
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
  if (existsSync(bareProjectPath)) {
    return {
      ok: true,
      sourceSha256: sourceHash.value.sha256,
      conversionCopyPath: bareProjectPath,
      alreadyExisted: true,
      packagePreserved: false,
      packageNote: "an earlier .aep-only copy already exists at this path and was left untouched"
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
  if (measured === "too-large") {
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
      packageNote: destInsideSource
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
    return {
      ok: false,
      reason: `could not copy the template package to ${packageDest}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (!existsSync(packageProjectPath)) {
    return { ok: false, reason: `the template package was copied but ${baseName} is not present at ${packageProjectPath}` };
  }

  return {
    ok: true,
    sourceSha256: sourceHash.value.sha256,
    conversionCopyPath: packageProjectPath,
    alreadyExisted: false,
    packagePreserved: true,
    packageNote: null
  };
}
