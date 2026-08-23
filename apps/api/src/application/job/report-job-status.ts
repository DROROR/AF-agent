import type { JobDto, ReportJobStatusRequest } from "@dyo/schemas";
import { JobConflictError, JobNotFoundError, UnauthorizedError } from "../../errors/app-error.js";
import { isValidJobStatusTransition } from "../../domain/job/rules.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import { toJobDto } from "./job-dto-mapper.js";

export interface ReportJobStatusDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  verifyToken: (token: string, storedHash: string) => Promise<boolean>;
  now: () => Date;
}

/**
 * A worker moving its own claimed job forward. The requested transition is
 * validated against the job's actual current status (never trusted blindly
 * from the request), and the repository write is a compare-and-swap on
 * that same status - so a job that already completed, or that raced
 * against a concurrent report, is rejected rather than silently
 * double-processed or overwritten.
 */
export async function reportJobStatus(
  deps: ReportJobStatusDeps,
  workerId: string,
  jobId: string,
  token: string,
  request: ReportJobStatusRequest
): Promise<JobDto> {
  const worker = await deps.workerRepository.findById(workerId);
  if (!worker) {
    throw new UnauthorizedError("Invalid worker credentials");
  }

  const validToken = await deps.verifyToken(token, worker.tokenHash);
  if (!validToken) {
    throw new UnauthorizedError("Invalid worker credentials");
  }

  const existing = await deps.jobRepository.findById(jobId);
  if (!existing || existing.workerId !== workerId) {
    // Same shape whether the job doesn't exist or simply isn't this
    // worker's - a worker must never be able to distinguish the two by
    // probing job IDs it doesn't own.
    throw new JobNotFoundError(jobId);
  }

  if (!isValidJobStatusTransition(existing.status, request.status)) {
    throw new JobConflictError(
      `Cannot transition job ${jobId} from ${existing.status} to ${request.status}`
    );
  }

  const updated = await deps.jobRepository.updateStatus(
    jobId,
    workerId,
    {
      expectedCurrentStatus: existing.status,
      status: request.status,
      ...(request.result !== undefined ? { result: request.result } : {}),
      ...(request.error !== undefined ? { error: request.error } : {}),
      ...(request.checkpoint !== undefined ? { checkpoint: request.checkpoint } : {})
    },
    deps.now()
  );

  if (!updated) {
    // The transition was valid against what we just read, but the row
    // changed underneath us before the write landed (e.g. a concurrent
    // report) - a real conflict, not a silent success.
    throw new JobConflictError(`Job ${jobId} changed concurrently and could not be updated`);
  }

  return toJobDto(updated);
}
