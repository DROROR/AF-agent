import type { JobDto } from "@dyo/schemas";
import type { JobRepository } from "../../domain/job/types.js";
import { JobNotFoundError } from "../../errors/app-error.js";
import { toJobDto } from "./job-dto-mapper.js";

export interface GetJobForUserDeps {
  jobRepository: JobRepository;
}

/**
 * GET /api/jobs/:jobId (dashboard session, see routes/jobs.ts) - the one
 * dashboard-facing read of a job's own status/result, primarily for
 * INSPECT_TEMPLATE/INSPECT_RENDER_CAPABILITIES, which have no project to
 * scope access through yet (see dispatch-job.ts's own doc comment).
 * Ownership is enforced by `createdByUserId` - set at dispatch time from
 * the caller's own session, never caller-supplied here or there. A job
 * that exists but belongs to a different user (or was never dispatched
 * from the dashboard, so createdByUserId is null) is refused with the
 * exact same JobNotFoundError a genuinely nonexistent job id gets - same
 * "never confirm existence to someone who doesn't own it" convention as
 * AssetCrossProjectAccessError/SuggestionCrossProjectAccessError.
 */
export async function getJobForUser(deps: GetJobForUserDeps, userId: string, jobId: string): Promise<JobDto> {
  const job = await deps.jobRepository.findById(jobId);
  if (!job || job.createdByUserId !== userId) {
    throw new JobNotFoundError(jobId);
  }
  return toJobDto(job);
}
