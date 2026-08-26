import type { ErrorCode } from "@dyo/schemas";

function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "WORKER_NOT_FOUND":
    case "JOB_NOT_FOUND":
    case "PROJECT_NOT_FOUND":
    case "EXECUTION_PLAN_NOT_FOUND":
    case "ASSET_NOT_FOUND":
    case "WORK_MAP_NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "WORKER_OFFLINE":
    case "PRECONDITION_NOT_MET":
    case "WORKER_BUSY":
      return 409;
    case "PAYLOAD_TOO_LARGE":
      return 413;
    case "UNSUPPORTED_MEDIA_TYPE":
      return 415;
    case "RATE_LIMITED":
      return 429;
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
