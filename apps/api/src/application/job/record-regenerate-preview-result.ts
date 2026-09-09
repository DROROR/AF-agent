import { executeSceneEditRequestSchema, sceneEditResultSchema, WORKING_COPY_DISTRUST_FAILURE_CODES, type JobDto } from "@dyo/schemas";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";

export interface RecordRegeneratePreviewResultDeps {
  executionSessionRepository: ExecutionSessionRepository;
  now: () => Date;
}

/**
 * First Preview regeneration (live QA, 2026-09-08/09) - the previewOnly
 * counterpart to recordExecuteFrameResultIfApplicable, called alongside
 * it (routes/jobs.ts) but acting on a disjoint set of jobs: this one
 * returns immediately unless the job's own persisted request payload has
 * `previewOnly: true`, and that function now does the mirror check (see
 * its own updated doc comment) - exactly ONE of the two ever acts on any
 * given EXECUTE_FRAME job's reported result.
 *
 * The real preview PNG itself is already durably recorded by the
 * separate worker->API preview upload (uploadPreview, during the job's
 * own RUNNING phase, before this ever runs) - this function's only job is
 * bringing the SESSION back to the human approval gate once a genuinely
 * successful regeneration is confirmed:
 *   - genuine SUCCESS (no workingCopyFailureCode, no failureReason, a
 *     real workingProjectSha256): moves the session to
 *     AWAITING_PREVIEW_APPROVAL - from FAILED (the rejected-preview
 *     recovery case) or idempotently from AWAITING_PREVIEW_APPROVAL
 *     itself (regenerating again before ever rejecting). Never touches
 *     completedScenePlanIds/latestWorkingProjectSha256 - previewOnly
 *     never edits anything, there is nothing new to record there.
 *   - a chain-of-custody failure (workingCopyFailureCode set, e.g. the
 *     previewOnly-specific WORKING_COPY_UNEXPECTEDLY_MUTATED, or any of
 *     the others): marks/keeps the session FAILED - exactly as severe
 *     during a supposedly read-only recapture as during a real edit -
 *     AND, for the subset in WORKING_COPY_DISTRUST_FAILURE_CODES,
 *     permanently sets workingCopyTrusted false (2026-09-09 real
 *     incident, session 5040ce97: this is what stops the dashboard from
 *     indefinitely re-offering regeneration from a working copy already
 *     proven to have diverged from this session's own record).
 *   - an ordinary capture failure (failureReason set, or no working-copy
 *     hash): leaves the session exactly as it already was, so the
 *     operator can simply try regenerating again.
 * A session already COMPLETED is never touched either way.
 */
export async function recordRegeneratePreviewResultIfApplicable(deps: RecordRegeneratePreviewResultDeps, job: JobDto): Promise<void> {
  if (job.operation !== "EXECUTE_FRAME") {
    return;
  }
  if (job.status !== "SUCCEEDED" && job.status !== "FAILED") {
    return;
  }
  if (!job.projectId) {
    return;
  }

  const parsedPayload = executeSceneEditRequestSchema.safeParse(job.payload);
  if (!parsedPayload.success || parsedPayload.data.previewOnly !== true) {
    return;
  }

  const parsedResult = sceneEditResultSchema.safeParse(job.result);
  if (!parsedResult.success) {
    return;
  }
  const result = parsedResult.data;

  const session = await deps.executionSessionRepository.findById(result.executionSessionId);
  if (!session || session.projectId !== job.projectId) {
    return;
  }
  if (session.status === "COMPLETED") {
    return;
  }

  if (result.workingCopyFailureCode !== null) {
    await deps.executionSessionRepository.markStatus(session.id, "FAILED", deps.now());
    // First Preview regeneration trust flag (live QA, 2026-09-09, the
    // exact real incident this whole function exists to guard against
    // recurring silently): a previewOnly run discovering
    // WORKING_COPY_UNEXPECTEDLY_MUTATED (or WORKING_COPY_MISSING/
    // WORKING_COPY_SHA_MISMATCH) proves the working copy on disk has
    // diverged from this session's own record - permanently exclude it
    // from ever being offered for regeneration again, regardless of how
    // "recoverable" its other fields still look.
    if ((WORKING_COPY_DISTRUST_FAILURE_CODES as readonly string[]).includes(result.workingCopyFailureCode)) {
      await deps.executionSessionRepository.markWorkingCopyDistrusted(session.id, deps.now());
    }
    return;
  }
  if (result.failureReason !== null || !result.workingProjectSha256) {
    return;
  }

  if (session.status === "FAILED" || session.status === "AWAITING_PREVIEW_APPROVAL") {
    await deps.executionSessionRepository.markStatus(session.id, "AWAITING_PREVIEW_APPROVAL", deps.now());
  }
}
