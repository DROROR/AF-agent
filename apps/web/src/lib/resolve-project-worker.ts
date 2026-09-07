import { AE_MCP_DEPENDENT_CAPABILITIES, type WorkerCapability, type WorkerDto } from "@dyo/schemas";
import { findDispatchableWorker } from "./find-dispatchable-worker";

/**
 * Project-aware replacement for calling findDispatchableWorker directly on
 * an AE-dependent, project-scoped capability (INSPECT_SCENE_EVIDENCE,
 * EXECUTE_FRAME, CREATE_PREVIEW, RENDER) - live QA Blocker 1 ("Jobs for a
 * local-AEP project must consistently execute on the Worker that owns/
 * inspected that source project").
 *
 * When `sourceWorkerId` is set (the project has recorded real inspection
 * provenance - see project.ts's own doc comment), this is the ONLY worker
 * ever considered: fails closed (returns null - never a different worker,
 * even an ONLINE/idle/capable one) if that exact worker is missing,
 * offline, busy, lacks the capability, or (for an AE/MCP-dependent
 * capability) isn't currently AE/MCP available. The real API
 * (dispatch-job.ts / create-execution-session.ts) enforces the same rule
 * server-side regardless of what this picks - this is a UX convenience
 * only, same as findDispatchableWorker's own doc comment.
 *
 * When `sourceWorkerId` is null (no recorded provenance - a pre-migration
 * project, or one genuinely created without it), falls back to the
 * existing generic findDispatchableWorker heuristic unchanged, preserving
 * today's behavior for those projects.
 */
export function resolveProjectWorker(workers: WorkerDto[] | null, capability: WorkerCapability, sourceWorkerId: string | null): WorkerDto | null {
  if (!workers) {
    return null;
  }
  if (sourceWorkerId === null) {
    return findDispatchableWorker(workers, capability);
  }
  const assigned = workers.find((worker) => worker.workerId === sourceWorkerId);
  if (!assigned) {
    return null;
  }
  if (assigned.status !== "ONLINE" || assigned.currentJobId !== null) {
    return null;
  }
  if (!assigned.capabilities.includes(capability)) {
    return null;
  }
  if (AE_MCP_DEPENDENT_CAPABILITIES.has(capability) && (assigned.aeAvailability !== "ONLINE" || assigned.mcpAvailability !== "ONLINE")) {
    return null;
  }
  return assigned;
}
