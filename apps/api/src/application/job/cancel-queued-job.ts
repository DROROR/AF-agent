import type { JobDto } from "@dyo/schemas";
import type { JobRepository } from "../../domain/job/types.js";
import { JobNotFoundError, PreconditionNotMetError } from "../../errors/app-error.js";
import { toJobDto } from "./job-dto-mapper.js";

export interface CancelQueuedJobDeps {
  jobRepository: JobRepository;
  now: () => Date;
}

/**
 * POST /api/jobs/:jobId/cancel - lets the operator who dispatched a job
 * cancel it while it is still QUEUED.
 *
 * REAL GAP THIS CLOSES (2026-09-12, job df76c2be): a job was dispatched
 * moments before its worker went silent, so it was never claimed. There was
 * no cancel path anywhere in the API, and a non-terminal job BLOCKS every
 * future dispatch of the same operation for that worker
 * (hasNonTerminalJobForOperation in dispatch-job.ts). The result was a job
 * that could neither run nor be cleared, and a dispatch surface that stayed
 * blocked behind it - recoverable only by hand-editing the database.
 *
 * Ownership follows getJobForUser exactly: a job belonging to someone else
 * is refused as NOT FOUND, never as FORBIDDEN, so this endpoint cannot be
 * used to discover which job ids exist.
 */
export async function cancelQueuedJob(deps: CancelQueuedJobDeps, userId: string, jobId: string): Promise<JobDto> {
  const job = await deps.jobRepository.findById(jobId);
  if (!job || job.createdByUserId !== userId) {
    throw new JobNotFoundError(jobId);
  }
  if (job.status !== "QUEUED") {
    throw new PreconditionNotMetError(
      `Job ${jobId} is ${job.status}, not QUEUED - only a job that has never been claimed can be cancelled. A job already running on a worker must be stopped on the worker, never by a database status change.`
    );
  }

  const cancelled = await deps.jobRepository.cancelQueued(
    jobId,
    {
      code: "ABANDONED_RECONCILED",
      message: `Cancelled by the operator who dispatched it, while still QUEUED and never claimed.`
    },
    deps.now()
  );
  if (!cancelled) {
    // It was claimed between the read above and the write - a real race, and
    // the worker now owns it. Report the same precondition failure rather
    // than retrying, so we never race a worker that is already executing.
    throw new PreconditionNotMetError(`Job ${jobId} was claimed by its worker before it could be cancelled`);
  }
  return toJobDto(cancelled);
}
