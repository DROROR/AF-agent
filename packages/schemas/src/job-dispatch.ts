import { z } from "zod";
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
export const DISPATCHABLE_OPERATIONS = ["INSPECT_TEMPLATE"] as const;
export type DispatchableOperation = (typeof DISPATCHABLE_OPERATIONS)[number];
export const dispatchableOperationSchema = z.enum(DISPATCHABLE_OPERATIONS);

/**
 * POST /api/jobs request body. `payload` is validated against
 * INSPECT_TEMPLATE's own real contract right here at the boundary - never
 * `z.unknown()`/`z.any()` - so a malformed or unrelated payload is
 * rejected before a job is ever created (defense in depth alongside
 * create-job.ts's own validateJobPayload() call).
 */
export const dispatchJobRequestSchema = z.object({
  operation: dispatchableOperationSchema,
  workerId: z.string().uuid(),
  payload: inspectTemplateRequestSchema
});
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
