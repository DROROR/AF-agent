import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ensureWorkRoot, safeJoin } from "../workspace/work-root.js";
import { hashSourceProject } from "./hash-source-project.js";

/**
 * Real 2026-09-11 incident (candidate "dro tempelate.aep", AE version
 * 23.2.1 -> 26.3x87): a template that requires an interactive AE-level
 * confirmation to open (most commonly a version-conversion prompt, but
 * also possibly an unacknowledged missing-font/plugin warning) cannot be
 * opened via a suppressed-dialogs `app.open()` call at all - AE returns
 * without throwing, but ends up with no project loaded (see
 * heroic-swan-template-inspector.ts's ensureTargetProjectOpen, and
 * jsx-templates.ts's buildOpenProjectScript's own beginSuppressDialogs).
 * There is no documented ExtendScript API to script past a REQUIRED
 * interactive AE dialog - a human must open the file once directly in AE,
 * respond to whatever dialog appears, and save the result - CLAUDE.md
 * rule 9 ("on a suspected AE modal, pause safely") applies exactly here.
 *
 * What IS safely automatable, and what this module does: derive a
 * DETERMINISTIC, generic (never per-template-hardcoded) destination path
 * for a disposable copy of the source project, keyed by the source's own
 * real sha256 (never its path or name) so the same source always maps to
 * the same conversion-copy location regardless of what it's called or
 * where it lives - and create that copy via a PLAIN filesystem copy, never
 * involving AE at all. The ORIGINAL source file is only ever READ (to
 * hash and copy it) - never opened, mutated, or overwritten by this
 * module. Once a human manually opens the resulting COPY in AE, resolves
 * its conversion dialog, and saves it back to that exact same path (never
 * the original), INSPECT_TEMPLATE can simply be re-dispatched with
 * `sourceProjectPath` pointed at this copy - no new job type or capability
 * is needed, since the existing open/inspect flow already succeeds once a
 * file no longer requires an interactive step to open.
 */
export function conversionCopyPath(workRoot: string, sourceSha256: string): string {
  return safeJoin(workRoot, "template-conversions", sourceSha256, "converted.aep");
}

export interface PrepareConversionCopyParams {
  workRoot: string;
  sourceProjectPath: string;
}

export type ConversionCopyResult =
  | {
      ok: true;
      sourceSha256: string;
      conversionCopyPath: string;
      /** True when a copy from an earlier attempt already existed at the deterministic path and was left as-is (never re-copied over - a human may already be mid-way through converting/saving it). */
      alreadyExisted: boolean;
    }
  | { ok: false; reason: string };

/**
 * Hashes the real source file on disk (never trusts a caller-supplied
 * hash) and, unless a copy already exists at the resulting deterministic
 * path, copies it there verbatim. Never overwrites an existing copy -
 * a human may already have started converting/saving it, and re-copying
 * over that would silently discard their work. Never touches the source
 * file itself beyond reading it to hash and copy.
 */
export async function prepareConversionCopy(params: PrepareConversionCopyParams): Promise<ConversionCopyResult> {
  const sourceHash = await hashSourceProject(params.sourceProjectPath);
  if (!sourceHash.ok) {
    return { ok: false, reason: `could not hash the source project to derive a conversion-copy path: ${sourceHash.reason}` };
  }

  const destPath = conversionCopyPath(params.workRoot, sourceHash.value.sha256);
  if (existsSync(destPath)) {
    return { ok: true, sourceSha256: sourceHash.value.sha256, conversionCopyPath: destPath, alreadyExisted: true };
  }

  ensureWorkRoot(path.dirname(destPath));
  try {
    copyFileSync(params.sourceProjectPath, destPath);
  } catch (error) {
    return {
      ok: false,
      reason: `could not create a disposable copy at ${destPath}: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  return { ok: true, sourceSha256: sourceHash.value.sha256, conversionCopyPath: destPath, alreadyExisted: false };
}
