import type { WorkerDto } from "@dyo/schemas";

export interface OverviewMetrics {
  workersOnline: number;
  workersTotal: number;
  aeOnline: number;
  mcpOnline: number;
  activeJobs: { workerId: string; workerName: string; jobId: string }[];
  mostRecentHeartbeatAt: string | null;
}

/**
 * Pure derivation from the real worker list already fetched by
 * useDashboardStatus - no separate API call, nothing fabricated. `workers`
 * is null when the API's worker list itself could not be fetched/parsed;
 * callers should show that as an error state, not pass it here.
 */
export function computeOverviewMetrics(workers: WorkerDto[]): OverviewMetrics {
  let mostRecentHeartbeatAt: string | null = null;
  for (const worker of workers) {
    if (worker.lastHeartbeatAt && (!mostRecentHeartbeatAt || worker.lastHeartbeatAt > mostRecentHeartbeatAt)) {
      mostRecentHeartbeatAt = worker.lastHeartbeatAt;
    }
  }

  return {
    workersOnline: workers.filter((w) => w.status === "ONLINE").length,
    workersTotal: workers.length,
    // aeAvailability/mcpAvailability, never the raw aeStatus/mcpStatus - a
    // Worker that has gone offline keeps its last-reported aeStatus/mcpStatus
    // frozen at whatever it last said, which must not count as "online" here.
    aeOnline: workers.filter((w) => w.aeAvailability === "ONLINE").length,
    mcpOnline: workers.filter((w) => w.mcpAvailability === "ONLINE").length,
    activeJobs: workers
      .filter((w): w is WorkerDto & { currentJobId: string } => w.currentJobId !== null)
      .map((w) => ({ workerId: w.workerId, workerName: w.name, jobId: w.currentJobId })),
    mostRecentHeartbeatAt
  };
}
