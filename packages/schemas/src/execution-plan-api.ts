import { z } from "zod";
import { executionPlanSchema, sceneTableRowSchema } from "./execution-plan.js";

/** POST /api/projects/:projectId/execution-plan - creates the initial DRAFT plan from the project's current manifest, or 409s if one already exists (use GET instead). */
export const createExecutionPlanRequestSchema = z.object({});
export type CreateExecutionPlanRequest = z.infer<typeof createExecutionPlanRequestSchema>;

/** Every execution-plan response carries both the raw plan (for editing/persistence) and the derived flat Dynamic Scene Table rows (for the dashboard), so a client never has to re-flatten it independently. */
export const executionPlanResponseSchema = z.object({
  plan: executionPlanSchema,
  sceneTable: z.array(sceneTableRowSchema)
});
export type ExecutionPlanResponse = z.infer<typeof executionPlanResponseSchema>;
