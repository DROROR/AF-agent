import type { ErrorCode } from "@dyo/schemas";

function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "WORKER_NOT_FOUND":
      return 404;
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
