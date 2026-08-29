import { z } from "zod";
import { placeholderTypeSchema } from "./template-manifest.js";
import { layerTransformSchema } from "./execute-scene-edit.js";

/**
 * Strict, allowlisted execution-plan edit operations - deliberately never
 * a generic JSON-patch/replace endpoint (Phase 4 requirement). Each
 * operation is its own object shape with exactly the fields it needs;
 * unknown/extra fields are rejected by z.discriminatedUnion + object
 * schemas below, and an operation name outside this list is rejected
 * outright rather than attempted.
 *
 * "mark mapping approved"/"reject/request correction" (Phase 4 section 6)
 * operate on the owning ScenePlanEntry's approvalState - a scene's
 * mappings are reviewed as a unit (see execution-plan.ts's doc comment
 * for why approvalState lives on the scene, not each mapping).
 */
export const EXECUTION_PLAN_EDIT_OPERATION_TYPES = [
  "INCLUDE_SCENE",
  "EXCLUDE_SCENE",
  "SET_FINAL_ORDER",
  "MAP_ASSET",
  "CLEAR_ASSET",
  "SET_TEXT",
  "CLEAR_TEXT",
  "SET_ASSET_TIMESTAMP",
  "CLEAR_ASSET_TIMESTAMP",
  "SET_FINAL_DURATION",
  "CLEAR_FINAL_DURATION",
  "SET_INSTRUCTIONS",
  "CLEAR_INSTRUCTIONS",
  "SET_BRAND_COLOR",
  "CLEAR_BRAND_COLOR",
  "SET_LAYER_VISIBILITY",
  "CLEAR_LAYER_VISIBILITY",
  "SET_TIME_REMAP_FREEZE",
  "CLEAR_TIME_REMAP_FREEZE",
  "SET_LAYER_DURATION",
  "CLEAR_LAYER_DURATION",
  "APPROVE_SCENE",
  "REJECT_SCENE",
  "SET_REELS_LAYOUT",
  "CLEAR_REELS_LAYOUT"
] as const;
export type ExecutionPlanEditOperationType = (typeof EXECUTION_PLAN_EDIT_OPERATION_TYPES)[number];

// .strict() on every operation below: an unexpected extra field (a command
// string, a path, anything else) is rejected outright rather than
// silently stripped - this is never a generic "attach whatever you want"
// payload, matching checkHealthRequestSchema's own precedent.
const includeSceneSchema = z.object({ type: z.literal("INCLUDE_SCENE"), scenePlanId: z.string().min(1) }).strict();
const excludeSceneSchema = z.object({ type: z.literal("EXCLUDE_SCENE"), scenePlanId: z.string().min(1) }).strict();

const setFinalOrderSchema = z
  .object({
    type: z.literal("SET_FINAL_ORDER"),
    scenePlanId: z.string().min(1),
    finalOrder: z.number().int().nonnegative()
  })
  .strict();

const mapAssetSchema = z
  .object({
    type: z.literal("MAP_ASSET"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1),
    selectedAssetId: z.string().min(1),
    selectedAssetType: placeholderTypeSchema
  })
  .strict();
const clearAssetSchema = z
  .object({
    type: z.literal("CLEAR_ASSET"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1)
  })
  .strict();

const setTextSchema = z
  .object({
    type: z.literal("SET_TEXT"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1),
    text: z.string().min(1)
  })
  .strict();
const clearTextSchema = z
  .object({
    type: z.literal("CLEAR_TEXT"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1)
  })
  .strict();

const setAssetTimestampSchema = z
  .object({
    type: z.literal("SET_ASSET_TIMESTAMP"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1),
    assetTimestamp: z.number().nonnegative()
  })
  .strict();
const clearAssetTimestampSchema = z
  .object({
    type: z.literal("CLEAR_ASSET_TIMESTAMP"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1)
  })
  .strict();

const setFinalDurationSchema = z
  .object({
    type: z.literal("SET_FINAL_DURATION"),
    scenePlanId: z.string().min(1),
    finalDuration: z.number().positive()
  })
  .strict();
const clearFinalDurationSchema = z.object({ type: z.literal("CLEAR_FINAL_DURATION"), scenePlanId: z.string().min(1) }).strict();

/** Accepts a 3- or 6-digit hex color, with or without a leading "#" - the operator-facing input is deliberately more forgiving than the canonical persisted form; apply-execution-plan-edit.ts normalizes it to #RRGGBB (uppercase) before it is ever written to a mapping (execution-plan.ts's own doc comment on colorHex). */
const HEX_COLOR_INPUT_PATTERN = /^#?[0-9A-Fa-f]{3}$|^#?[0-9A-Fa-f]{6}$/;

const setBrandColorSchema = z
  .object({
    type: z.literal("SET_BRAND_COLOR"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1),
    colorHex: z.string().regex(HEX_COLOR_INPUT_PATTERN, "colorHex must be a 3 or 6 digit hex color, with or without a leading #")
  })
  .strict();
const clearBrandColorSchema = z
  .object({
    type: z.literal("CLEAR_BRAND_COLOR"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1)
  })
  .strict();

const setLayerVisibilitySchema = z
  .object({
    type: z.literal("SET_LAYER_VISIBILITY"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1),
    enabled: z.boolean()
  })
  .strict();
const clearLayerVisibilitySchema = z
  .object({
    type: z.literal("CLEAR_LAYER_VISIBILITY"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1)
  })
  .strict();

const setTimeRemapFreezeSchema = z
  .object({
    type: z.literal("SET_TIME_REMAP_FREEZE"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1),
    freezeAtSeconds: z.number().nonnegative()
  })
  .strict();
const clearTimeRemapFreezeSchema = z
  .object({
    type: z.literal("CLEAR_TIME_REMAP_FREEZE"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1)
  })
  .strict();

/** Layer-scoped duration override - deliberately named/typed distinctly from SET_FINAL_DURATION (scene-level, above) - see execution-plan.ts's layerDurationSeconds doc comment. */
const setLayerDurationSchema = z
  .object({
    type: z.literal("SET_LAYER_DURATION"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1),
    layerDurationSeconds: z.number().positive()
  })
  .strict();
const clearLayerDurationSchema = z
  .object({
    type: z.literal("CLEAR_LAYER_DURATION"),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1)
  })
  .strict();

const setInstructionsSchema = z
  .object({
    type: z.literal("SET_INSTRUCTIONS"),
    scenePlanId: z.string().min(1),
    instructions: z.string().min(1)
  })
  .strict();
const clearInstructionsSchema = z.object({ type: z.literal("CLEAR_INSTRUCTIONS"), scenePlanId: z.string().min(1) }).strict();

const approveSceneSchema = z.object({ type: z.literal("APPROVE_SCENE"), scenePlanId: z.string().min(1) }).strict();
const rejectSceneSchema = z
  .object({
    type: z.literal("REJECT_SCENE"),
    scenePlanId: z.string().min(1),
    /** Required, never silent - a rejection/correction request always carries a reason, merged into the scene's notes. */
    reason: z.string().min(1)
  })
  .strict();

/** Sets this scene's own reelsLayout (execution-plan.ts) - the human-approval gate for native Reels output (2026-08-29 closure requirement, section 1). Browser sends only the approved layout intent; the server never invents/adjusts these values. */
const setReelsLayoutSchema = z
  .object({
    type: z.literal("SET_REELS_LAYOUT"),
    scenePlanId: z.string().min(1),
    reelsCompositionName: z.string().min(1),
    layerTransforms: z.array(layerTransformSchema).min(1)
  })
  .strict();
const clearReelsLayoutSchema = z.object({ type: z.literal("CLEAR_REELS_LAYOUT"), scenePlanId: z.string().min(1) }).strict();

export const executionPlanEditOperationSchema = z.discriminatedUnion("type", [
  includeSceneSchema,
  excludeSceneSchema,
  setFinalOrderSchema,
  mapAssetSchema,
  clearAssetSchema,
  setTextSchema,
  clearTextSchema,
  setAssetTimestampSchema,
  clearAssetTimestampSchema,
  setFinalDurationSchema,
  clearFinalDurationSchema,
  setInstructionsSchema,
  clearInstructionsSchema,
  setBrandColorSchema,
  clearBrandColorSchema,
  setLayerVisibilitySchema,
  clearLayerVisibilitySchema,
  setTimeRemapFreezeSchema,
  clearTimeRemapFreezeSchema,
  setLayerDurationSchema,
  clearLayerDurationSchema,
  approveSceneSchema,
  rejectSceneSchema,
  setReelsLayoutSchema,
  clearReelsLayoutSchema
]);
export type ExecutionPlanEditOperation = z.infer<typeof executionPlanEditOperationSchema>;

/**
 * PATCH /api/execution-plans/:id request body - baseRevision is required
 * optimistic-concurrency protection (Phase 4: "stale plan revision...
 * must fail"): the caller must name the revision they read and are
 * editing against; a mismatch against the current stored revision is
 * rejected rather than silently applied over a newer edit.
 */
export const updateExecutionPlanRequestSchema = z.object({
  baseRevision: z.number().int().positive(),
  operations: z.array(executionPlanEditOperationSchema).min(1)
});
export type UpdateExecutionPlanRequest = z.infer<typeof updateExecutionPlanRequestSchema>;

export const approveExecutionPlanRequestSchema = z.object({ baseRevision: z.number().int().positive() });
export type ApproveExecutionPlanRequest = z.infer<typeof approveExecutionPlanRequestSchema>;

/**
 * No plan-level rejection reason field exists yet (ExecutionPlan has no
 * such column/property) - use the REJECT_SCENE edit operation's own
 * required `reason` (execution-plan-edit.ts above) to record why a
 * specific scene was rejected; that already persists into the scene's
 * notes. Adding a plan-wide reason is a real but separate, smaller future
 * enhancement, not invented here to avoid accepting input this endpoint
 * would otherwise silently discard.
 */
export const rejectExecutionPlanRequestSchema = z.object({ baseRevision: z.number().int().positive() });
export type RejectExecutionPlanRequest = z.infer<typeof rejectExecutionPlanRequestSchema>;

/** Reopens an APPROVED/REJECTED plan back to DRAFT - an explicit human decision to resume editing, never automatic. */
export const reopenExecutionPlanRequestSchema = z.object({ baseRevision: z.number().int().positive() });
export type ReopenExecutionPlanRequest = z.infer<typeof reopenExecutionPlanRequestSchema>;
