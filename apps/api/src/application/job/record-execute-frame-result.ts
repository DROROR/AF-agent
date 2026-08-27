import { sceneEditResultSchema, type JobDto } from "@dyo/schemas";
import { deriveExecutionSessionStatus } from "../../domain/execution-session/derive-status.js";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";

export interface RecordExecuteFrameResultDeps {
  executionSessionRepository: ExecutionSessionRepository;
  executionPlanRepository: ExecutionPlanRepository;
  now: () => Date;
}

/**
 * Called after a worker's job-status report has already been durably
 * applied (reportJobStatus succeeded) - never a second, competing write
 * path for the job's own status/result, mirroring record-scene-evidence.ts/
 * record-render-artifact.ts's own doc comment verbatim.
 *
 * Multi-scene-accumulation phase, section 6/7 - replaces the old
 * "always reflects whichever EXECUTE_FRAME job most recently succeeded"
 * behavior (see execution_plans' own now-superseded working-copy columns):
 *
 *   - On a genuine SUCCESS (job.status SUCCEEDED, result parses, its own
 *     failureReason is null, both working-copy fields present): appends
 *     `scenePlanId` to the session's completedScenePlanIds (idempotent),
 *     advances latestWorkingProjectSha256 to this job's own verified
 *     workingProjectSha256, and re-derives status via
 *     deriveExecutionSessionStatus (PREPARING -> EDITING/
 *     AWAITING_PREVIEW_APPROVAL -> READY_TO_RENDER as scenes complete and
 *     the preview gate clears).
 *   - On a chain-of-custody failure (`workingCopyFailureCode` set -
 *     WORKING_COPY_MISSING/WORKING_COPY_SHA_MISMATCH): marks the session
 *     FAILED (terminal - section 7: "do NOT silently restart from
 *     original once accumulated edits exist"; section 11's "start a new
 *     execution session" is the only way forward).
 *   - Any other outcome (an ordinary AE-mutation failure, a job still
 *     mid-retry): leaves the session untouched - still EDITING/PREPARING,
 *     retryable by dispatching EXECUTE_FRAME again for the same scene.
 *
 * A session already in a TERMINAL status is never touched again here
 * either way (a stale/duplicate report arriving after the session was
 * already marked FAILED/COMPLETED must not resurrect it).
 */
export async function recordExecuteFrameResultIfApplicable(deps: RecordExecuteFrameResultDeps, job: JobDto): Promise<void> {
  if (job.operation !== "EXECUTE_FRAME") {
    return;
  }
  // A chain-of-custody failure is reported as a job-level FAILED (see
  // job-dispatcher.ts's runExecuteFrame: any non-null failureReason,
  // including WORKING_COPY_MISSING/SHA_MISMATCH, is a FAILED job) - this
  // function must still see it to mark the session FAILED. Every OTHER
  // outcome besides genuine SUCCEEDED/FAILED (QUEUED/CLAIMED/RUNNING/etc.)
  // is never actionable here.
  if (job.status !== "SUCCEEDED" && job.status !== "FAILED") {
    return;
  }
  if (!job.projectId) {
    return;
  }

  const parsed = sceneEditResultSchema.safeParse(job.result);
  if (!parsed.success) {
    return;
  }
  const result = parsed.data;

  const session = await deps.executionSessionRepository.findById(result.executionSessionId);
  if (!session || session.projectId !== job.projectId) {
    return;
  }
  if (session.status === "COMPLETED" || session.status === "FAILED") {
    return;
  }

  if (result.workingCopyFailureCode !== null) {
    await deps.executionSessionRepository.markStatus(session.id, "FAILED", deps.now());
    return;
  }

  if (result.failureReason !== null || !result.workingProjectSha256) {
    return;
  }

  const plan = await deps.executionPlanRepository.findCurrentByProjectId(job.projectId);
  const requiredScenePlanIds = (plan && plan.revision === session.planRevision ? plan.scenePlans : [])
    .filter((s) => s.use && s.approvalState === "APPROVED" && s.unresolvedReasons.length === 0)
    .map((s) => s.id);
  const nextCompletedScenePlanIds = session.completedScenePlanIds.includes(result.scenePlanId)
    ? session.completedScenePlanIds
    : [...session.completedScenePlanIds, result.scenePlanId];

  const nextStatus = deriveExecutionSessionStatus({
    requiredScenePlanIds,
    completedScenePlanIds: nextCompletedScenePlanIds,
    firstPreviewApproved: session.firstPreviewApproved
  });

  await deps.executionSessionRepository.recordSceneCompleted(session.id, result.scenePlanId, result.workingProjectSha256, nextStatus, deps.now());
}
