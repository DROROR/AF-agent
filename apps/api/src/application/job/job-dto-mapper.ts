import type { JobDto } from "@dyo/schemas";
import type { Job } from "../../domain/job/types.js";

export function toJobDto(job: Job): JobDto {
  return {
    jobId: job.id,
    workerId: job.workerId,
    operation: job.operation,
    status: job.status,
    payload: job.payload,
    result: job.result,
    error: job.error,
    checkpoint: job.checkpoint,
    createdAt: job.createdAt.toISOString(),
    claimedAt: job.claimedAt ? job.claimedAt.toISOString() : null,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    updatedAt: job.updatedAt.toISOString()
  };
}
