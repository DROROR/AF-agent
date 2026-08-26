import { z } from "zod";
import { aeStatusSchema, mcpStatusSchema } from "./worker.js";

/**
 * CHECK_HEALTH takes no operator-supplied parameters at all - it always
 * runs exactly the same two fixed, already-approved diagnostics (AE
 * process check, `node <AE_MCP_PATH>/dist/index.js health`). `.strict()`
 * so any unexpected field (a command string, a path, anything else) is
 * rejected at the API boundary rather than silently ignored - this is
 * never a generic "run a command" endpoint.
 */
export const checkHealthRequestSchema = z.object({}).strict();
export type CheckHealthRequest = z.infer<typeof checkHealthRequestSchema>;

/**
 * Bounded, secret-free diagnostic detail for the one fixed subprocess this
 * operation ever runs. Never includes the worker token, registration
 * secret, full environment, or arbitrary filesystem contents - only what
 * is needed to remotely diagnose an AE/MCP health disagreement.
 */
export const mcpHealthProcessResultSchema = z.object({
  aeMcpPathConfigured: z.boolean(),
  /** null only when aeMcpPathConfigured is false (never checked, not "unknown"). */
  scriptExists: z.boolean().nullable(),
  /** null when the process never produced a real exit code (spawn failure, killed for timeout). */
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean()
});
export type McpHealthProcessResult = z.infer<typeof mcpHealthProcessResultSchema>;

export const checkHealthResponseSchema = z.object({
  aeStatus: aeStatusSchema,
  aeVersion: z.string().nullable(),
  mcpStatus: mcpStatusSchema,
  mcpProcess: mcpHealthProcessResultSchema,
  checkedAt: z.string().datetime()
});
export type CheckHealthResponse = z.infer<typeof checkHealthResponseSchema>;
