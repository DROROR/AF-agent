import { statSync } from "node:fs";

export type ValidateRenderArtifactResult =
  | { ok: true; byteSize: number }
  | { ok: false; reason: string };

/**
 * A render is only ever SUCCESS if the expected output file genuinely
 * exists, is a regular file, and is non-zero size (render-engine phase
 * section 10). Called ONLY after this same process just deleted any
 * pre-existing file at this path and then ran aerender to completion (see
 * render-project-executor.ts) - so "stale previous output" cannot pass:
 * there is no window in which an old file could satisfy this check without
 * this attempt's own aerender invocation having (re)written it.
 */
export function validateRenderArtifact(outputPath: string): ValidateRenderArtifactResult {
  let stat;
  try {
    stat = statSync(outputPath);
  } catch (error) {
    return {
      ok: false,
      reason: `expected output file does not exist at ${outputPath}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: `expected output path ${outputPath} is not a regular file` };
  }
  if (stat.size <= 0) {
    return { ok: false, reason: `output file at ${outputPath} is zero bytes` };
  }
  return { ok: true, byteSize: stat.size };
}
