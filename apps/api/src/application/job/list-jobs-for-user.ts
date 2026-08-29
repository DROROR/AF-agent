import type { JobHistoryEntryDto, ListJobsResponse } from "@dyo/schemas";
import type { JobRepository } from "../../domain/job/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";

/** Bounded, not paginated - a single operator's job volume is low; a fixed cap avoids an ever-growing unbounded response rather than inventing pagination this UI doesn't yet need. */
const JOB_HISTORY_LIMIT = 200;

export interface ListJobsForUserDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  projectRepository: ProjectRepository;
}

function extractExecutionSessionId(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "executionSessionId" in payload) {
    const value = (payload as Record<string, unknown>).executionSessionId;
    return typeof value === "string" ? value : null;
  }
  return null;
}

/**
 * A dashboard user's own full job dispatch history, newest first - "job
 * history + errors" (2026-08-29 closure requirement): no DB/curl access
 * should ever be required to understand what happened to a past job, only
 * the dashboard. Scoped to createdByUserId - the exact same ownership
 * anchor get-job-for-user.ts already uses for a single job - so this can
 * never leak another user's job history. Worker/project ids are resolved
 * to human-readable names here (batched, one lookup per unique id) so the
 * browser never has to separately fetch every worker/project just to label
 * one history row.
 */
export async function listJobsForUser(deps: ListJobsForUserDeps, userId: string): Promise<ListJobsResponse> {
  const jobs = await deps.jobRepository.listByCreatedByUserId(userId, JOB_HISTORY_LIMIT);

  const workerIds = [...new Set(jobs.map((job) => job.workerId))];
  const projectIds = [...new Set(jobs.map((job) => job.projectId).filter((id): id is string => id !== null))];
  const [workers, projects] = await Promise.all([
    Promise.all(workerIds.map((id) => deps.workerRepository.findById(id))),
    Promise.all(projectIds.map((id) => deps.projectRepository.findById(id)))
  ]);
  const workerNameById = new Map(workerIds.map((id, index) => [id, workers[index]?.name ?? null]));
  const projectNameById = new Map(projectIds.map((id, index) => [id, projects[index]?.name ?? null]));

  const entries: JobHistoryEntryDto[] = jobs.map((job) => ({
    jobId: job.id,
    operation: job.operation,
    status: job.status,
    workerId: job.workerId,
    workerName: workerNameById.get(job.workerId) ?? null,
    projectId: job.projectId,
    projectName: job.projectId ? (projectNameById.get(job.projectId) ?? null) : null,
    executionSessionId: extractExecutionSessionId(job.payload),
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    updatedAt: job.updatedAt.toISOString()
  }));

  return { jobs: entries };
}
