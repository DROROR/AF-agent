import type { RenderOutputVariant } from "@dyo/schemas";
import { jobWorkspacePath, safeJoin } from "../../workspace/work-root.js";

const OUTPUT_FILENAME = "output.mp4";

/**
 * Deterministic, worker-derived render output path - job-scoped, keyed by
 * (workRoot, jobId, variant), NEVER a caller-supplied path (render-engine
 * phase section 7: "Render destination must be worker-derived... Never
 * trust a raw output filesystem path from the dashboard/model"). Uses the
 * SAME job-scoped-workspace primitive (jobWorkspacePath/safeJoin) already
 * proven for EXECUTE_FRAME's own working-copy path.
 */
export function renderOutputPath(workRoot: string, jobId: string, variant: RenderOutputVariant): string {
  return safeJoin(jobWorkspacePath(workRoot, jobId), "renders", variant.toLowerCase(), OUTPUT_FILENAME);
}

export function renderOutputFilename(): string {
  return OUTPUT_FILENAME;
}
