import { z } from "zod";
import { executionPlanSchema, planStatusSchema, sceneTableRowSchema } from "./execution-plan.js";

/** POST /api/projects/:projectId/execution-plan - creates the initial DRAFT plan from the project's current manifest, or 409s if one already exists (use GET instead). */
export const createExecutionPlanRequestSchema = z.object({});
export type CreateExecutionPlanRequest = z.infer<typeof createExecutionPlanRequestSchema>;

/** Every execution-plan response carries both the raw plan (for editing/persistence) and the derived flat Dynamic Scene Table rows (for the dashboard), so a client never has to re-flatten it independently. */
export const executionPlanResponseSchema = z.object({
  plan: executionPlanSchema,
  sceneTable: z.array(sceneTableRowSchema)
});
export type ExecutionPlanResponse = z.infer<typeof executionPlanResponseSchema>;

/**
 * GET /api/projects/:projectId/execution-plan/revisions - a lightweight
 * summary per persisted revision (never the full scenePlans payload for
 * every past revision; the dashboard's revision history view only needs
 * these facts, and the current revision's full detail is already
 * available via GET .../execution-plan). Read-only, additive: no plan
 * content is derivable or mutable from this endpoint.
 */
export const executionPlanRevisionSummarySchema = z.object({
  revision: z.number().int().positive(),
  status: planStatusSchema,
  sceneCount: z.number().int().nonnegative(),
  approvedAt: z.string().datetime().nullable(),
  approvedBy: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  isCurrent: z.boolean()
});
export type ExecutionPlanRevisionSummary = z.infer<typeof executionPlanRevisionSummarySchema>;

export const listExecutionPlanRevisionsResponseSchema = z.object({
  revisions: z.array(executionPlanRevisionSummarySchema)
});
export type ListExecutionPlanRevisionsResponse = z.infer<typeof listExecutionPlanRevisionsResponseSchema>;
