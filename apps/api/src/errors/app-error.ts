import type { ErrorCode } from "@dyo/schemas";

function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "WORKER_NOT_FOUND":
    case "JOB_NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
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
