import type { JobRepository } from "../../domain/job/types.js";

export interface SweepStaleJobsDeps {
  jobRepository: JobRepository;
  now: () => Date;
  staleAfterMs: number;
}

/**
 * Recovery for "worker goes offline before/while running a job": fails
 * every non-terminal job whose worker's heartbeat has gone stale, rather
 * than leaving it stuck in CLAIMED/RUNNING/WAITING_FOR_ACTION forever or
 * blindly retrying it. Mirrors sweep-stale-workers.ts's lazy-sweep-before-read
 * pattern - called before claim/list operations, not on a separate timer.
 */
export async function sweepStaleJobs(deps: SweepStaleJobsDeps): Promise<string[]> {
  return deps.jobRepository.failJobsForStaleWorkers(deps.now(), deps.staleAfterMs);
}
