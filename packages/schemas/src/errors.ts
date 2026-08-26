import { z } from "zod";

/**
 * Every typed application error the API can return uses one of these codes.
 * Adding a new failure mode means adding a code here first - see
 * docs/engineering/API_STANDARDS.md and docs/engineering/ERROR_HANDLING.md.
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "WORKER_NOT_FOUND",
  "JOB_NOT_FOUND",
  "PROJECT_NOT_FOUND",
  "EXECUTION_PLAN_NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  /** Worker is not currently ONLINE (never reported in, or heartbeat has gone stale) - job dispatch refuses rather than queuing against a worker that may not be there. */
  "WORKER_OFFLINE",
  /** Worker is ONLINE but a required safety precondition (AE/MCP status, required capability) isn't met right now. */
  "PRECONDITION_NOT_MET",
  /** Worker is already at its concurrency limit, or already has a live job for the requested operation - dispatch refuses rather than double-queuing. */
  "WORKER_BUSY",
  "INTERNAL_ERROR"
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export const errorCodeSchema = z.enum(ERROR_CODES);

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string()
  })
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
