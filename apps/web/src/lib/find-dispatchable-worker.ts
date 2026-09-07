import { AE_MCP_DEPENDENT_CAPABILITIES, type WorkerCapability, type WorkerDto } from "@dyo/schemas";

/**
 * Client-side "which worker to dispatch to" heuristic (activation-phase
 * section 6) - a single-worker-MVP convenience only (CLAUDE.md: "Initial
 * Worker 1... One AE job per worker initially"), never a security
 * boundary: the real API independently re-verifies every one of these
 * same conditions (ONLINE, AE/MCP ONLINE where relevant, capability,
 * idle) at dispatch time regardless of what this picks - see
 * dispatch-job.ts. Returns null (never a guess) when no worker currently
 * qualifies, so the caller can show an honest "no worker available" state
 * instead of dispatching to a worker that will just be refused.
 *
 * Selection precondition consistency (live QA Blocker 1, section 5): for a
 * capability in AE_MCP_DEPENDENT_CAPABILITIES, a worker whose AE/MCP
 * availability isn't currently ONLINE is never considered "dispatchable" -
 * dispatch-job.ts would immediately refuse it anyway, so calling it
 * dispatchable here was misleading. aeAvailability/mcpAvailability (not
 * the raw aeStatus/mcpStatus) are used because they are already
 * connectivity-gated - see worker.ts's own doc comment on
 * aeAvailability. Non-AE capabilities (e.g. CHECK_HEALTH) are unaffected.
 */
export function findDispatchableWorker(workers: WorkerDto[] | null, capability: WorkerCapability): WorkerDto | null {
  if (!workers) {
    return null;
  }
  const requiresAeMcp = AE_MCP_DEPENDENT_CAPABILITIES.has(capability);
  return (
    workers.find(
      (worker) =>
        worker.status === "ONLINE" &&
        worker.currentJobId === null &&
        worker.capabilities.includes(capability) &&
        (!requiresAeMcp || (worker.aeAvailability === "ONLINE" && worker.mcpAvailability === "ONLINE"))
    ) ?? null
  );
}
