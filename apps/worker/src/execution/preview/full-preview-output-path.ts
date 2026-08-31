import { jobWorkspacePath, safeJoin } from "../../workspace/work-root.js";

const OUTPUT_FILENAME = "preview.mp4";

/**
 * Deterministic, worker-derived complete-preview output path - job-scoped,
 * keyed by (workRoot, jobId), NEVER a caller-supplied path (same rule as
 * render-output-path.ts's own doc comment). A full preview is not
 * LANDSCAPE/REELS - just one preview per job, so unlike renderOutputPath
 * this takes no variant.
 */
export function fullPreviewOutputPath(workRoot: string, jobId: string): string {
  return safeJoin(jobWorkspacePath(workRoot, jobId), "full-preview", OUTPUT_FILENAME);
}

export function fullPreviewOutputFilename(): string {
  return OUTPUT_FILENAME;
}
