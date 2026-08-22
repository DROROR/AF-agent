/**
 * Typed error hierarchy for the worker process - mirrors the categories in
 * docs/engineering/ERROR_HANDLING.md (validation, auth, infrastructure,
 * retryable). Nothing here is thrown as a raw string.
 */
export abstract class WorkerError extends Error {
  abstract readonly category: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Configuration is missing or invalid at startup - not retryable. */
export class ConfigError extends WorkerError {
  readonly category = "config";
}

/** Could not reach the API at all (DNS/connect/timeout). Retryable via backoff. */
export class NetworkError extends WorkerError {
  readonly category = "network";
}

/** API reachable but rejected our credentials (401). Requires human action. */
export class UnauthorizedApiError extends WorkerError {
  readonly category = "auth";
}

/** API reachable but returned an unexpected status/body. Retryable via backoff. */
export class ApiResponseError extends WorkerError {
  readonly category = "infrastructure";
  readonly statusCode: number;

  constructor(message: string, statusCode: number, options?: { cause?: unknown }) {
    super(message, options);
    this.statusCode = statusCode;
  }
}

/** A configured filesystem path escapes the worker's WORK_ROOT. Never allowed. */
export class UnsafePathError extends WorkerError {
  readonly category = "security";
  readonly reason: "traversal" | "absolute" | "invalid-segment";

  constructor(message: string, reason: "traversal" | "absolute" | "invalid-segment") {
    super(message);
    this.reason = reason;
  }
}
