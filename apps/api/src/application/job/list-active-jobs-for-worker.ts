import type { JobDto } from "@dyo/schemas";
import { UnauthorizedError } from "../../errors/app-error.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import { toJobDto } from "./job-dto-mapper.js";

export interface ListActiveJobsForWorkerDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  verifyToken: (token: string, storedHash: string) => Promise<boolean>;
}

/**
 * Worker-authenticated (same bearer-token channel as heartbeat/claim/
 * report - never a dashboard session) read of this worker's own
 * non-terminal jobs. A freshly started worker process (a new, empty
 * JobExecutionRegistry) calls this once at startup to discover any job
 * left behind by a worker process that never reported its own outcome
 * (crashed/killed mid-job) - see reconcile-abandoned-jobs.ts on the
 * worker side and job-execution-registry.ts's own doc comment (P3/P4
 * stuck-job recovery, 2026-09-04).
 */
export async function listActiveJobsForWorker(
  deps: ListActiveJobsForWorkerDeps,
  workerId: string,
  token: string
): Promise<JobDto[]> {
  const worker = await deps.workerRepository.findById(workerId);
  if (!worker) {
    throw new UnauthorizedError("Invalid worker credentials");
  }

  const validToken = await deps.verifyToken(token, worker.tokenHash);
  if (!validToken) {
    throw new UnauthorizedError("Invalid worker credentials");
  }

  const jobs = await deps.jobRepository.listActiveForWorker(workerId);
  return jobs.map(toJobDto);
}
