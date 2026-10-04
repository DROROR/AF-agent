import type { CurrentExecutionSessionResponse } from "@dyo/schemas";
import { isRecoverableForPreviewRegeneration, isSessionActive } from "../../domain/execution-session/is-session-active.js";
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
 *
 * First Preview regeneration (live QA, 2026-09-08/09 fix, 2026-09-09
 * correction): a FAILED session recoverable for preview regeneration
 * (isRecoverableForPreviewRegeneration) is ALSO returned here, even
 * though isSessionActive alone calls it inactive - otherwise the
 * dashboard's own "current session" read sees null and falls back to
 * "Start execution", which is the exact bug this closes. Every other
 * terminal session (a genuine chain-of-custody failure, or one that
 * never got far enough to have completed work) is still correctly
 * returned as null, exactly as before.
 */
export async function getCurrentExecutionSession(deps: GetCurrentExecutionSessionDeps, projectId: string): Promise<CurrentExecutionSessionResponse> {
  const plan = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  const latest = await deps.executionSessionRepository.findLatestByProjectId(projectId);
  // REAL 2026-10-04 DEFECT (project 5db054f5, seen on the live dashboard
  // minutes after its first final render succeeded): the session became
  // COMPLETED, this read returned null, and every screen fell back to the
  // very beginning - the banner said "Create the first preview", the Preview
  // tab offered "Build my video", Export said "Not ready yet" next to the
  // finished, downloadable video. A session that COMPLETED for the plan
  // revision still current is the project's state, not the absence of one:
  // its approvals are what the finished video was made from. It is returned
  // (it stays terminal - nothing can be dispatched against it, the server's
  // own gates decide that, not this read); a session of a superseded
  // revision is still not returned, so editing the plan starts afresh.
  const completedForCurrentPlan = plan !== null && latest !== null && latest.status === "COMPLETED" && latest.planRevision === plan.revision;
  if (!plan || !latest || (!isSessionActive(latest, plan.revision) && !isRecoverableForPreviewRegeneration(latest, plan.revision) && !completedForCurrentPlan)) {
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
