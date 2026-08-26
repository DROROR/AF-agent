import { z } from "zod";
import { checkHealthRequestSchema } from "./check-health.js";
import { inspectTemplateRequestSchema } from "./inspect-template.js";
import { jobStatusSchema } from "./job.js";

/**
 * Operations a dashboard operator may dispatch via POST /api/jobs - a
 * strict subset of WORKER_CAPABILITIES (worker.ts). Adding a new
 * operation here means it has a real, reviewed, allowlisted request
 * contract below; this is never a generic "run any capability" endpoint,
 * and never accepts an arbitrary operation string - see CLAUDE.md Safety
 * Rule 2 ("never execute arbitrary AI-generated JSX... only tested,
 * versioned, allowlisted scripts/operations").
 */
export const DISPATCHABLE_OPERATIONS = ["INSPECT_TEMPLATE", "CHECK_HEALTH"] as const;
export type DispatchableOperation = (typeof DISPATCHABLE_OPERATIONS)[number];
export const dispatchableOperationSchema = z.enum(DISPATCHABLE_OPERATIONS);

/**
 * POST /api/jobs request body - a discriminated union keyed by
 * `operation`, so each operation's payload is validated against its own
 * real, reviewed contract right here at the boundary, never
 * `z.unknown()`/`z.any()`. CHECK_HEALTH's payload is a strict empty
 * object - no command string, no path, no arbitrary field is ever
 * accepted for it. Defense in depth alongside create-job.ts's own
 * validateJobPayload() call, which validates again independently.
 */
export const dispatchJobRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("INSPECT_TEMPLATE"),
    workerId: z.string().uuid(),
    payload: inspectTemplateRequestSchema
  }),
  z.object({
    operation: z.literal("CHECK_HEALTH"),
    workerId: z.string().uuid(),
    payload: checkHealthRequestSchema
  })
]);
export type DispatchJobRequest = z.infer<typeof dispatchJobRequestSchema>;

/** Safe DTO only - never the worker's token/tokenHash, never any other job's internal fields. */
export const dispatchJobResponseSchema = z.object({
  jobId: z.string().uuid(),
  workerId: z.string().uuid(),
  operation: dispatchableOperationSchema,
  status: jobStatusSchema,
  createdAt: z.string().datetime()
});
export type DispatchJobResponse = z.infer<typeof dispatchJobResponseSchema>;
