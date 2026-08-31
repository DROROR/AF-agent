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

/**
 * PUT /api/projects/:projectId/execution-plan/render-outputs/:variant
 * (render-delivery phase section 1/2) - an explicit, human-confirmed
 * selection of ONE real manifest composition as the render master for
 * this variant. The server independently re-verifies `manifestCompositionId`
 * resolves to a real composition in the project's CURRENT manifest whose
 * own `aeProjectItemIndex`/`name` match exactly what's submitted here -
 * never trusts a browser-submitted index/name pair on their own (section
 * 2: "Do not allow arbitrary numeric index entry"). `sourceProjectSha256`
 * is NEVER accepted from the request - the server stamps the plan's own
 * current value at write time (section 3).
 */
export const setRenderOutputConfigRequestSchema = z
  .object({
    manifestCompositionId: z.string().min(1),
    renderSettingsTemplateName: z.string().min(1),
    outputModuleTemplateName: z.string().min(1)
  })
  .strict();
export type SetRenderOutputConfigRequest = z.infer<typeof setRenderOutputConfigRequestSchema>;

/**
 * POST /api/projects/:projectId/execution-plan/reconcile-readiness
 * (mapping-review propagation fix) - explicitly recomputes every scene's
 * `unresolvedReasons`/`approvalState` from its real, current mapping
 * state, for a plan whose CONTENT was edited before this fix existed
 * (see reconcile-execution-plan-readiness.ts's own doc comment for the
 * full safety contract - never touches mapping content, never bumps
 * revision, never touches plan status, idempotent/no-op when nothing is
 * actually stale). No request body: operates on the project's own
 * current plan only, never client-supplied targeting.
 */
export const reconcileExecutionPlanReadinessRequestSchema = z.object({});
export type ReconcileExecutionPlanReadinessRequest = z.infer<typeof reconcileExecutionPlanReadinessRequestSchema>;

export const reconcileExecutionPlanReadinessResponseSchema = z.object({
  changed: z.boolean(),
  changedScenePlanIds: z.array(z.string().min(1)),
  plan: executionPlanSchema,
  sceneTable: z.array(sceneTableRowSchema)
});
export type ReconcileExecutionPlanReadinessResponse = z.infer<typeof reconcileExecutionPlanReadinessResponseSchema>;
