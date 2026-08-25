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
  "CONFLICT",
  "RATE_LIMITED",
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
