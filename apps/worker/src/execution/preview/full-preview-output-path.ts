import { jobWorkspacePath, safeJoin } from "../../workspace/work-root.js";
import { assertValidOutputBasename } from "../../workspace/output-basename.js";

const OUTPUT_FILENAME = "preview.mp4";

/**
 * Deterministic, worker-derived complete-preview output path - job-scoped,
 * keyed by (workRoot, jobId), NEVER a caller-supplied path (same rule as
 * render-output-path.ts's own doc comment). A full preview is not
 * LANDSCAPE/REELS - just one preview per job, so unlike renderOutputPath
 * this takes no variant.
 *
 * The basename is asserted safe on every call (live QA, 2026-09-10 real
 * incident audit - see assertValidOutputBasename's own doc comment) -
 * "validate basename before spawning aerender," even though
 * OUTPUT_FILENAME above is a fixed literal today.
 */
export function fullPreviewOutputPath(workRoot: string, jobId: string): string {
  const filename = assertValidOutputBasename(OUTPUT_FILENAME, ".mp4");
  return safeJoin(jobWorkspacePath(workRoot, jobId), "full-preview", filename);
}

export function fullPreviewOutputFilename(): string {
  return OUTPUT_FILENAME;
}
