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

/**
 * Key-order-independent JSON form. REAL 2026-09-15 FINDING: job payloads are
 * stored as PostgreSQL jsonb, which re-orders object keys, so comparing a
 * stored operations array with a freshly resolved one via JSON.stringify
 * never matched - every EXECUTE_FRAME retry silently started fresh.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * EXECUTE_FRAME resumes ONLY a prior attempt that applied, saved and verified
 * every operation (its checkpoint covers all of them and records
 * savedWorkingProjectSha256) - the worker then runs capture-only against that
 * pinned copy. A partial checkpoint is deliberately not resumed: its completed
 * edits may only ever have existed unsaved inside After Effects (lost on any
 * AE/worker restart), so skipping them would produce a wrong frame. Such a
 * retry starts fresh, and the worker rebuilds the copy from the verified source.
 */
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
    canonicalJson(priorPayload.operations) === canonicalJson(resolvedPayload.operations);
  if (!sameIntent) {
    return null;
  }
  const completed = new Set(checkpoint.completedOperationIndices);
  const operationCount = resolvedPayload.operations.length;
  const everyOperationCompleted = operationCount > 0 && Array.from({ length: operationCount }, (_, index) => index).every((index) => completed.has(index));
  if (!everyOperationCompleted || !checkpoint.savedWorkingProjectSha256) {
    return null;
  }
  return checkpoint;
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
