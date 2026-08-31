import type { ErrorCode } from "@dyo/schemas";

function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
    case "AI_PROVIDER_CONNECTION_FAILED":
    case "AI_WORK_MAP_NOT_CONFIGURED":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "WORKER_NOT_FOUND":
    case "JOB_NOT_FOUND":
    case "PROJECT_NOT_FOUND":
    case "EXECUTION_PLAN_NOT_FOUND":
    case "ASSET_NOT_FOUND":
    case "WORK_MAP_NOT_FOUND":
    case "SUGGESTION_NOT_FOUND":
    case "RENDER_ARTIFACT_NOT_FOUND":
    case "EXECUTION_SESSION_NOT_FOUND":
    case "PREVIEW_NOT_FOUND":
    case "FULL_PREVIEW_NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "WORKER_OFFLINE":
    case "PRECONDITION_NOT_MET":
    case "WORKER_BUSY":
    case "PROJECT_HAS_ACTIVE_JOB":
      return 409;
    case "PAYLOAD_TOO_LARGE":
      return 413;
    case "UNSUPPORTED_MEDIA_TYPE":
      return 415;
    case "RATE_LIMITED":
      return 429;
    case "NO_USABLE_SUGGESTIONS":
    case "AI_MAPPING_BATCH_TRUNCATED":
    case "NO_USABLE_WORK_MAP_DRAFT":
      return 422;
    case "INTERNAL_ERROR":
      return 500;
  }
}

/**
 * Base class for every error the API deliberately raises. Route handlers
 * never construct raw Error/strings for expected failure modes - see
 * docs/engineering/ERROR_HANDLING.md ("Do not throw raw strings or swallow
 * errors").
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusForCode(code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Missing or invalid credentials") {
    super("UNAUTHORIZED", message);
    this.name = "UnauthorizedError";
  }
}

export class WorkerNotFoundError extends AppError {
  constructor(workerId: string) {
    super("WORKER_NOT_FOUND", `Worker ${workerId} was not found`);
    this.name = "WorkerNotFoundError";
  }
}

export class JobNotFoundError extends AppError {
  constructor(jobId: string) {
    super("JOB_NOT_FOUND", `Job ${jobId} was not found`);
    this.name = "JobNotFoundError";
  }
}

/** Duplicate claim, an invalid status transition, or a report against an already-terminal job - never a silent no-op, never a blind overwrite. */
export class JobConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "JobConflictError";
  }
}

/** Signup with an email that's already registered. Safe to reveal on signup (unlike login) - see application/auth/log-in.ts for why login never does this. */
export class EmailAlreadyRegisteredError extends AppError {
  constructor() {
    super("CONFLICT", "An account with this email already exists");
    this.name = "EmailAlreadyRegisteredError";
  }
}

/** Wrong email, wrong password, or an expired/invalid session - always the same generic message so a response never reveals which case occurred. */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super("UNAUTHORIZED", "Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

/** Job dispatch refused: the target worker has never reported in, or its heartbeat has gone stale - never trust a cached "ONLINE" DB value alone. */
export class WorkerOfflineError extends AppError {
  constructor(workerId: string) {
    super("WORKER_OFFLINE", `Worker ${workerId} is not currently ONLINE (no fresh heartbeat)`);
    this.name = "WorkerOfflineError";
  }
}

/** Job dispatch refused: the worker is ONLINE, but a required live precondition (AE status, MCP status, required capability) is not currently met. */
export class PreconditionNotMetError extends AppError {
  constructor(message: string) {
    super("PRECONDITION_NOT_MET", message);
    this.name = "PreconditionNotMetError";
  }
}

/** Job dispatch refused: the worker is already at its concurrency limit, or already has a live job for the requested operation. */
export class WorkerBusyError extends AppError {
  constructor(message: string) {
    super("WORKER_BUSY", message);
    this.name = "WorkerBusyError";
  }
}

export class ProjectNotFoundError extends AppError {
  constructor(projectId: string) {
    super("PROJECT_NOT_FOUND", `Project ${projectId} was not found`);
    this.name = "ProjectNotFoundError";
  }
}

export class ExecutionPlanNotFoundError extends AppError {
  constructor(projectId: string) {
    super("EXECUTION_PLAN_NOT_FOUND", `No execution plan exists yet for project ${projectId}`);
    this.name = "ExecutionPlanNotFoundError";
  }
}

/** A project already has a current execution plan - create is a one-time action; use GET/update instead of creating a second one. */
export class ExecutionPlanAlreadyExistsError extends AppError {
  constructor(projectId: string) {
    super("CONFLICT", `Project ${projectId} already has an execution plan`);
    this.name = "ExecutionPlanAlreadyExistsError";
  }
}

/** The caller's baseRevision no longer matches the plan's current revision - optimistic-concurrency protection against a stale edit silently overwriting a newer one. */
export class StaleExecutionPlanRevisionError extends AppError {
  constructor(expected: number, actual: number) {
    super("CONFLICT", `Expected revision ${expected}, but the current revision is ${actual} - reload the plan and retry`);
    this.name = "StaleExecutionPlanRevisionError";
  }
}

/** An edit operation referenced a scenePlanId/mappingId that doesn't exist in this plan, or would create a conflicting state (e.g. a duplicate finalOrder among included scenes). */
export class ExecutionPlanEditError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "ExecutionPlanEditError";
  }
}

/** Approval refused: the plan's own sourceProjectSha256 no longer matches its project's current manifest sha256 - CLAUDE.md Safety Rule 8 / Phase 4: never silently approve/execute a plan against a template revision it wasn't built for. */
export class SourceShaMismatchError extends AppError {
  constructor() {
    super("CONFLICT", "This plan's source project SHA256 no longer matches the project's current manifest - it cannot be approved");
    this.name = "SourceShaMismatchError";
  }
}

export class AssetNotFoundError extends AppError {
  constructor(assetId: string) {
    super("ASSET_NOT_FOUND", `Asset ${assetId} was not found`);
    this.name = "AssetNotFoundError";
  }
}

/** A render artifact doesn't exist at all, or exists but belongs to a different project - never distinguishable from the outside (same "same shape whether not found or not yours" convention as AssetCrossProjectAccessError below). */
export class RenderArtifactNotFoundError extends AppError {
  constructor(artifactId: string) {
    super("RENDER_ARTIFACT_NOT_FOUND", `Render artifact ${artifactId} was not found`);
    this.name = "RenderArtifactNotFoundError";
  }
}

export class ExecutionSessionNotFoundError extends AppError {
  constructor(sessionId: string) {
    super("EXECUTION_SESSION_NOT_FOUND", `Execution session ${sessionId} was not found`);
    this.name = "ExecutionSessionNotFoundError";
  }
}

/** The execution session exists, but has no preview captured yet - distinct from the session itself not existing. */
export class PreviewNotFoundError extends AppError {
  constructor(sessionId: string) {
    super("PREVIEW_NOT_FOUND", `Execution session ${sessionId} has no preview yet`);
    this.name = "PreviewNotFoundError";
  }
}

/** The execution session exists, but has no complete preview captured yet - distinct from the session itself not existing, and from PreviewNotFoundError (the mid-execution first-preview PNG). */
export class FullPreviewNotFoundError extends AppError {
  constructor(sessionId: string) {
    super("FULL_PREVIEW_NOT_FOUND", `Execution session ${sessionId} has no complete preview yet`);
    this.name = "FullPreviewNotFoundError";
  }
}

/** An asset exists, but not in the project the request named - never treated the same as "not found at all" in logs/tests, even though both return 404 to the client (never confirm to a caller which project an asset they don't own belongs to). */
export class AssetCrossProjectAccessError extends AppError {
  constructor(assetId: string, projectId: string) {
    super("ASSET_NOT_FOUND", `Asset ${assetId} was not found in project ${projectId}`);
    this.name = "AssetCrossProjectAccessError";
  }
}

/**
 * Delete refused: this asset is still referenced by `selectedAssetId` on
 * a mapping in the project's CURRENT execution plan revision. Rather
 * than silently deleting the file (leaving a dangling reference an
 * operator would only discover later, in the scene table) or silently
 * reaching into the execution plan to clear the mapping on the asset's
 * own behalf (a surprising cross-domain side effect), this refuses the
 * delete and tells the operator to unmap it first (CLEAR_ASSET) - see
 * delete-asset.ts's own doc comment for why this specific tradeoff was
 * chosen.
 */
export class AssetInUseError extends AppError {
  constructor(assetId: string) {
    super("CONFLICT", `Asset ${assetId} is still mapped to a scene in the current execution plan - unmap it (CLEAR_ASSET) before deleting`);
    this.name = "AssetInUseError";
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(reason: string) {
    super("UNSUPPORTED_MEDIA_TYPE", reason);
    this.name = "UnsupportedMediaTypeError";
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(maxBytes: number) {
    super("PAYLOAD_TOO_LARGE", `Upload exceeds the maximum allowed size of ${maxBytes} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

export class WorkMapNotFoundError extends AppError {
  constructor(projectId: string) {
    super("WORK_MAP_NOT_FOUND", `No work map exists yet for project ${projectId}`);
    this.name = "WorkMapNotFoundError";
  }
}

/** The caller's baseRevision no longer matches the work map's current revision - same optimistic-concurrency protection as StaleExecutionPlanRevisionError. */
export class StaleWorkMapRevisionError extends AppError {
  constructor(expected: number, actual: number) {
    super("CONFLICT", `Expected revision ${expected}, but the current work map revision is ${actual} - reload and retry`);
    this.name = "StaleWorkMapRevisionError";
  }
}

export class SuggestionNotFoundError extends AppError {
  constructor(suggestionId: string) {
    super("SUGGESTION_NOT_FOUND", `Mapping suggestion ${suggestionId} was not found`);
    this.name = "SuggestionNotFoundError";
  }
}

/** A suggestion belongs to a different project than the one named in the request - refused identically to SuggestionNotFoundError (never confirms it exists elsewhere), same pattern as AssetCrossProjectAccessError. */
export class SuggestionCrossProjectAccessError extends AppError {
  constructor(suggestionId: string, projectId: string) {
    super("SUGGESTION_NOT_FOUND", `Mapping suggestion ${suggestionId} was not found in project ${projectId}`);
    this.name = "SuggestionCrossProjectAccessError";
  }
}

/** Accept/reject refused: this suggestion has already been accepted or rejected - a suggestion's status is a one-way transition out of PENDING, never re-decided. */
export class SuggestionNotPendingError extends AppError {
  constructor(suggestionId: string, currentStatus: string) {
    super("CONFLICT", `Mapping suggestion ${suggestionId} is already ${currentStatus} - it can no longer be accepted or rejected`);
    this.name = "SuggestionNotPendingError";
  }
}

/** Accept refused: the suggested asset no longer exists (or belongs to a different project) - re-checked at accept time, never trusted from when the suggestion was generated. */
export class SuggestedAssetInvalidError extends AppError {
  constructor(assetId: string) {
    super("ASSET_NOT_FOUND", `Suggested asset ${assetId} no longer exists in this project's Asset Catalog`);
    this.name = "SuggestedAssetInvalidError";
  }
}

/** BYOK "Test Connection" / "Save & Connect" refused: the real Anthropic call failed - never persisted (connect-ai-provider.ts always tests before it ever encrypts/stores anything). */
export class AiProviderConnectionFailedError extends AppError {
  constructor(reason: string) {
    super("AI_PROVIDER_CONNECTION_FAILED", reason);
    this.name = "AiProviderConnectionFailedError";
  }
}

/**
 * A user's stored BYOK connection exists but could not be decrypted
 * (CREDENTIALS_ENCRYPTION_KEY missing/rotated on the server, or a
 * corrupted row) - a real server misconfiguration, surfaced with a clean,
 * actionable message rather than the generic catch-all "An unexpected
 * error occurred" (see resolve-ai-suggestion-provider.ts's own doc
 * comment on why this is never silently degraded past).
 */
export class AiProviderUnavailableError extends AppError {
  constructor(reason: string) {
    super("INTERNAL_ERROR", `AI provider is unavailable: ${reason}. Try reconnecting it in Settings.`);
    this.name = "AiProviderUnavailableError";
  }
}

/**
 * Real production bug, 2026-08-30: a real Anthropic call completed and
 * returned real proposals, but every one of them was rejected by domain/
 * reference validation (out-of-range confidence, an empty required id,
 * a reference to a target never asked about, ...), leaving nothing to
 * persist - generateMappingSuggestions used to silently return an empty
 * suggestions list with a 200 in this case, indistinguishable from "AI
 * genuinely had nothing to suggest." Never thrown when AI simply isn't
 * configured (aiAvailable: false already covers that honestly).
 *
 * Widened 2026-08-30 (batching): once generation is split into fixed-size
 * batches (see generate-mapping-suggestions.ts's AI_MAPPING_BATCH_SIZE)
 * and each batch's own stop_reason is checked for a MAX_TOKENS truncation
 * separately (see AiMappingBatchTruncatedError below), a real request
 * with eligible targets whose batches all completed normally yet
 * produced zero raw proposals in total is no longer a plausible "AI
 * genuinely had nothing to suggest" - the ambiguity that used to justify
 * treating a clean empty response as a legitimate outcome is gone now
 * that truncation is ruled out per-batch, so this also throws in that
 * case (proven in production: a real 106-target request, providerOutputTokens
 * exactly 8000, stop_reason "max_tokens").
 */
export class NoUsableMappingSuggestionsError extends AppError {
  constructor() {
    super("NO_USABLE_SUGGESTIONS", "AI returned no usable mapping suggestions. Please review the project inputs or try again.");
    this.name = "NoUsableMappingSuggestionsError";
  }
}

/**
 * Real production bug, 2026-08-30: a real Anthropic call for 106 eligible
 * targets in one request consumed its full 8000-token output budget
 * (providerOutputTokens: 8000, stop_reason: "max_tokens") before
 * completing a single valid proposal - proven directly from production
 * funnel logs. Batching (AI_MAPPING_BATCH_SIZE, see generate-mapping-
 * suggestions.ts) keeps each individual provider call small enough to
 * plausibly complete, but a batch can still legitimately hit the ceiling
 * (an unusually verbose model response, or a batch whose targets each
 * need more structured output than typical) - when that happens, that
 * batch's own output cannot be trusted (its JSON may be incomplete), so
 * the whole generation refuses rather than silently persisting a partial/
 * incomplete batch's proposals alongside good ones from other batches.
 * Never exposes Anthropic's stop_reason or token counts to the browser -
 * those are logged internally only (see the per-batch funnel log).
 */
export class AiMappingBatchTruncatedError extends AppError {
  constructor() {
    super("AI_MAPPING_BATCH_TRUNCATED", "AI could not complete part of the scene mapping. Please try again.");
    this.name = "AiMappingBatchTruncatedError";
  }
}

/** "Tell AI what you want" / Create Video Plan refused: this user has no AI provider connected yet - a clear, actionable message rather than a silent no-op or a generic 500. */
export class AiWorkMapNotConfiguredError extends AppError {
  constructor() {
    super("AI_WORK_MAP_NOT_CONFIGURED", "Connect an AI provider in Settings before creating a video plan with AI.");
    this.name = "AiWorkMapNotConfiguredError";
  }
}

/**
 * A real AI Work Map draft attempt ran (a real provider call was made)
 * but produced nothing usable - either it returned zero raw entries, or
 * every raw entry was rejected by validation. Mirrors
 * NoUsableMappingSuggestionsError's own rule and rationale (see that
 * class's doc comment) - never silently reported as an empty, successful
 * draft.
 */
export class NoUsableWorkMapDraftError extends AppError {
  constructor() {
    super("NO_USABLE_WORK_MAP_DRAFT", "AI could not build a plan from that description. Try adding more detail about which scene should show what.");
    this.name = "NoUsableWorkMapDraftError";
  }
}

/**
 * Delete Project refused: a QUEUED/CLAIMED/RUNNING/WAITING_FOR_ACTION job
 * still exists for this project (offline-safe-control-plane phase,
 * section 1: "refuse deletion while an active/running job exists") -
 * deleting the project's rows out from under an in-flight worker job would
 * cascade-delete state (execution plan, work map, assets) the worker may
 * still be reading mid-job, and would leave a job pointing at a project
 * that no longer exists. The operator must wait for the job to finish or
 * fail before deleting.
 */
export class ProjectHasActiveJobError extends AppError {
  constructor(projectId: string) {
    super("PROJECT_HAS_ACTIVE_JOB", `Project ${projectId} has a job still in progress - wait for it to finish before deleting`);
    this.name = "ProjectHasActiveJobError";
  }
}
