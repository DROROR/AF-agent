import type { JobDto } from "@dyo/schemas";
import { UnauthorizedError } from "../../errors/app-error.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import { toJobDto } from "./job-dto-mapper.js";
import { sweepStaleJobs } from "./sweep-stale-jobs.js";

export interface ClaimNextJobDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  verifyToken: (token: string, storedHash: string) => Promise<boolean>;
  now: () => Date;
  staleAfterMs: number;
}

/**
 * The worker asks for its own next job - never the reverse, and never any
 * other worker's queue. Returns null (not an error) when there is nothing
 * to claim, or when the worker is already at maxConcurrency - both are
 * normal, expected outcomes of polling, not failures.
 */
export async function claimNextJob(
  deps: ClaimNextJobDeps,
  workerId: string,
  token: string
): Promise<JobDto | null> {
  const worker = await deps.workerRepository.findById(workerId);
  if (!worker) {
    // Same response as an invalid token - never reveal whether a worker ID exists.
    throw new UnauthorizedError("Invalid worker credentials");
  }

  const validToken = await deps.verifyToken(token, worker.tokenHash);
  if (!validToken) {
    throw new UnauthorizedError("Invalid worker credentials");
  }

  await sweepStaleJobs({ jobRepository: deps.jobRepository, now: deps.now, staleAfterMs: deps.staleAfterMs });

  const job = await deps.jobRepository.claimNextForWorker(workerId, worker.maxConcurrency, deps.now());
  return job ? toJobDto(job) : null;
}
