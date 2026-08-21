import type { WorkerRepository } from "../../domain/worker/types.js";

export interface SweepStaleWorkersDeps {
  repository: WorkerRepository;
  now: () => Date;
  staleAfterMs: number;
}

/**
 * Persists ONLINE -> OFFLINE for any worker whose heartbeat has gone stale.
 * Called before every read so the dashboard/API never reports a worker as
 * ONLINE past its heartbeat window (acceptance criterion: "stale heartbeat
 * can mark worker offline").
 */
export async function sweepStaleWorkers(deps: SweepStaleWorkersDeps): Promise<string[]> {
  return deps.repository.markStaleWorkersOffline(deps.now(), deps.staleAfterMs);
}
