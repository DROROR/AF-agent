import type { CurrentExecutionSessionResponse } from "@dyo/schemas";
import { isSessionActive } from "../../domain/execution-session/is-session-active.js";
import { deriveExecutionSessionDisplayStatus } from "../../domain/execution-session/derive-display-status.js";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import type { JobRepository } from "../../domain/job/types.js";
import { toExecutionSessionDto } from "./execution-session-dto-mapper.js";

export interface GetCurrentExecutionSessionDeps {
  executionSessionRepository: ExecutionSessionRepository;
  executionPlanRepository: ExecutionPlanRepository;
  workerRepository: WorkerRepository;
  jobRepository: JobRepository;
  now: () => Date;
  staleAfterMs: number;
}

/**
 * GET .../execution-sessions/current (section 14) - returns the ACTIVE
 * session for this project's current plan revision, or null. "Active" is
 * never a stored flag (see is-session-active.ts); a session bound to a
 * superseded plan revision, or already terminal, is simply not returned
 * here (still readable directly by id if ever needed, never deleted).
 *
 * `status` on the returned DTO is the READ-TIME display overlay (section
 * 8/21: RENDERING/PAUSED are live-computed, never persisted) - see
 * derive-display-status.ts.
 */
export async function getCurrentExecutionSession(deps: GetCurrentExecutionSessionDeps, projectId: string): Promise<CurrentExecutionSessionResponse> {
  const plan = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  const latest = await deps.executionSessionRepository.findLatestByProjectId(projectId);
  if (!plan || !latest || !isSessionActive(latest, plan.revision)) {
    return { session: null };
  }

  const now = deps.now();
  const worker = await deps.workerRepository.findById(latest.assignedWorkerId);
  const currentJob = worker?.currentJobId ? await deps.jobRepository.findById(worker.currentJobId) : null;

  const displayStatus = deriveExecutionSessionDisplayStatus(
    latest.status,
    worker,
    currentJob
      ? { id: currentJob.id, operation: currentJob.operation, belongsToThisSession: isJobForSession(currentJob.payload, latest.id) }
      : null,
    now,
    deps.staleAfterMs
  );

  return { session: toExecutionSessionDto(latest, displayStatus) };
}

function isJobForSession(payload: unknown, sessionId: string): boolean {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  return (payload as { executionSessionId?: unknown }).executionSessionId === sessionId;
}
