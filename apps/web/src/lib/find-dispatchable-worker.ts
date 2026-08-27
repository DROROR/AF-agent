import type { WorkerCapability, WorkerDto } from "@dyo/schemas";

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
 */
export function findDispatchableWorker(workers: WorkerDto[] | null, capability: WorkerCapability): WorkerDto | null {
  if (!workers) {
    return null;
  }
  return workers.find((worker) => worker.status === "ONLINE" && worker.currentJobId === null && worker.capabilities.includes(capability)) ?? null;
}
