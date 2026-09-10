import type { RenderOutputVariant } from "@dyo/schemas";
import { jobWorkspacePath, safeJoin } from "../../workspace/work-root.js";
import { assertValidOutputBasename } from "../../workspace/output-basename.js";

const OUTPUT_FILENAME = "output.mp4";

/**
 * Deterministic, worker-derived render output path - job-scoped, keyed by
 * (workRoot, jobId, variant), NEVER a caller-supplied path (render-engine
 * phase section 7: "Render destination must be worker-derived... Never
 * trust a raw output filesystem path from the dashboard/model"). Uses the
 * SAME job-scoped-workspace primitive (jobWorkspacePath/safeJoin) already
 * proven for EXECUTE_FRAME's own working-copy path.
 *
 * The basename is asserted safe on every call (live QA, 2026-09-10 real
 * incident audit - see assertValidOutputBasename's own doc comment) -
 * "validate basename before spawning aerender," even though
 * OUTPUT_FILENAME above is a fixed literal today.
 */
export function renderOutputPath(workRoot: string, jobId: string, variant: RenderOutputVariant): string {
  const filename = assertValidOutputBasename(OUTPUT_FILENAME, ".mp4");
  return safeJoin(jobWorkspacePath(workRoot, jobId), "renders", variant.toLowerCase(), filename);
}

export function renderOutputFilename(): string {
  return OUTPUT_FILENAME;
}
