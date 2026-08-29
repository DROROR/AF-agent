import { sceneEditCheckpointSchema, type ExecuteSceneEditRequest, type RenderProjectRequest, type SceneEditCheckpoint } from "@dyo/schemas";
import type { Job, JobRepository } from "../../domain/job/types.js";

/**
 * True interrupted-job resume (client closure requirement): a genuinely
 * killed worker process should not force a scene/render to restart from its
 * very first operation/stage - the prior attempt's own durably-persisted
 * checkpoint (see report-job-checkpoint.ts) is reused IF AND ONLY IF the new
 * dispatch is provably resolving to the exact same intended work (same plan
 * revision, same working-copy SHA expectation, and - for EXECUTE_FRAME - the
 * exact same operations array). Any mismatch means the plan/session moved on
 * since the failed attempt, so the old checkpoint's operation-index
 * positions could silently mean something different now - reusing it then
 * would be exactly the kind of guessing this project explicitly rejects, so
 * this fails closed to null (fresh start) rather than ever guessing. Uses
 * the existing checkpoint model unchanged (sceneEditCheckpointSchema) - no
 * new job status, no new workflow.
 */
function extractValidCheckpoint(job: Job | null): SceneEditCheckpoint | null {
  if (!job || job.status !== "FAILED" || job.checkpoint === null || job.checkpoint === undefined) {
    return null;
  }
  const parsed = sceneEditCheckpointSchema.safeParse(job.checkpoint);
  if (!parsed.success || parsed.data.completedOperationIndices.length === 0) {
    return null;
  }
  return parsed.data;
}

export async function resolveExecuteFrameResumeCheckpoint(
  jobRepository: JobRepository,
  resolvedPayload: Omit<ExecuteSceneEditRequest, "checkpoint">
): Promise<SceneEditCheckpoint | null> {
  const prior = await jobRepository.findMostRecentForSessionKey(
    "EXECUTE_FRAME",
    resolvedPayload.executionSessionId,
    "scenePlanId",
    resolvedPayload.scenePlanId
  );
  const checkpoint = extractValidCheckpoint(prior);
  if (!checkpoint || !prior) {
    return null;
  }
  const priorPayload = prior.payload as ExecuteSceneEditRequest;
  const sameIntent =
    priorPayload.planId === resolvedPayload.planId &&
    priorPayload.planRevision === resolvedPayload.planRevision &&
    priorPayload.expectedWorkingProjectSha256 === resolvedPayload.expectedWorkingProjectSha256 &&
    JSON.stringify(priorPayload.operations) === JSON.stringify(resolvedPayload.operations);
  return sameIntent ? checkpoint : null;
}

export async function resolveRenderResumeCheckpoint(
  jobRepository: JobRepository,
  resolvedPayload: Omit<RenderProjectRequest, "checkpoint">
): Promise<SceneEditCheckpoint | null> {
  const prior = await jobRepository.findMostRecentForSessionKey(
    "RENDER",
    resolvedPayload.executionSessionId,
    "variant",
    resolvedPayload.variant
  );
  const checkpoint = extractValidCheckpoint(prior);
  if (!checkpoint || !prior) {
    return null;
  }
  const priorPayload = prior.payload as RenderProjectRequest;
  const sameIntent =
    priorPayload.planId === resolvedPayload.planId &&
    priorPayload.planRevision === resolvedPayload.planRevision &&
    priorPayload.expectedWorkingProjectSha256 === resolvedPayload.expectedWorkingProjectSha256 &&
    priorPayload.variant === resolvedPayload.variant;
  return sameIntent ? checkpoint : null;
}
