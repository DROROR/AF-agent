import { z } from "zod";
import { placeholderTypeSchema } from "./template-manifest.js";

/**
 * execution-plan.json domain model - see docs/SCHEMAS.md's illustrative
 * sketch and docs/PHASES.md Phase 4 ("Dynamic Approval Table + Execution
 * Plan"). Extends that sketch to the field-by-field detail this phase
 * requires, the same way template-manifest.ts extended its own sketch.
 *
 * Deliberately keeps four timing concepts distinct, never collapsed into
 * one field:
 *   - sourcePosition: where the composition sits in the ORIGINAL template
 *     (manifest scene.originalOrderIndex) - never changes once built.
 *   - finalOrder: where the scene appears in the FINAL output - fully
 *     independent of sourcePosition; reordering output never touches it.
 *   - finalDuration: how long the selected scene remains in the final
 *     video - a SCENE-level concept (matches docs/SCHEMAS.md's
 *     `finalDurationSeconds` living on the frame, not on an assignment).
 *   - assetTimestamp: for a video asset, which exact source timestamp to
 *     use - a per-MAPPING concept (matches docs/SCHEMAS.md's
 *     `videoTimestampSeconds` living on an assignment, not the frame).
 */

export const EXECUTION_PLAN_SCHEMA_VERSION = "1.0";

/** Plan-level lifecycle (docs/PHASES.md Phase 4: "DRAFT -> APPROVED -> execution"). REJECTED added for the "reject/reopen" capability - reopening returns a plan to DRAFT explicitly. */
export const PLAN_STATUSES = ["DRAFT", "APPROVED", "REJECTED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const planStatusSchema = z.enum(PLAN_STATUSES);

/** Per-scene (not per-plan) review state - a plan can be a mix of scenes at different states while still DRAFT overall. */
export const ROW_APPROVAL_STATES = ["UNREVIEWED", "NEEDS_MAPPING", "READY_FOR_APPROVAL", "APPROVED", "REJECTED"] as const;
export type RowApprovalState = (typeof ROW_APPROVAL_STATES)[number];
export const rowApprovalStateSchema = z.enum(ROW_APPROVAL_STATES);

/** Who/what produced a given mapping or classification value - never conflated with template-manifest.ts's evidenceSource (which answers "how was this MACHINE FACT determined", a different question from "who set this SEMANTIC value"). */
export const MAPPING_SOURCES = ["MANIFEST", "AI_SUGGESTION", "HUMAN"] as const;
export type MappingSource = (typeof MAPPING_SOURCES)[number];
export const mappingSourceSchema = z.enum(MAPPING_SOURCES);

/**
 * A typed, provenance-carrying semantic value - never a bare string. Used
 * for placeholderClassification: the manifest's own machine classification
 * (often "unknown") stays exactly that until AI or human evidence actually
 * resolves it - "no invented semantic certainty" (Phase 4 hard rule).
 */
export const provenanceSchema = z.object({
  value: placeholderTypeSchema.nullable(),
  source: mappingSourceSchema,
  evidence: z.array(z.string().min(1))
});
export type Provenance = z.infer<typeof provenanceSchema>;

/**
 * Zero-to-many per scene (PlaceholderMapping) - a scene with no manifest-
 * detected placeholders still exists as a ScenePlanEntry with an empty
 * mappings[] array (see scenePlanEntrySchema), it never disappears.
 * manifestPlaceholderId is nullable: a mapping can be human-added (e.g. a
 * text overlay the template didn't structurally expose as its own layer)
 * without being tied to any specific detected manifest placeholder.
 */
export const placeholderMappingSchema = z.object({
  id: z.string().min(1),
  manifestPlaceholderId: z.string().min(1).nullable(),
  placeholderName: z.string().nullable(),
  placeholderClassification: provenanceSchema,
  selectedAssetId: z.string().min(1).nullable(),
  selectedAssetType: placeholderTypeSchema.nullable(),
  text: z.string().nullable(),
  /** Seconds into the source asset - only meaningful for a video assetType, never confused with finalDuration (a scene-level concept, see below). */
  assetTimestamp: z.number().nonnegative().nullable(),
  /**
   * Explicit, operator-approved SET_BRAND_COLOR value (operation-resolution
   * phase, section A) - always the CANONICAL normalized form (#RRGGBB,
   * uppercase) by the time it lands here; normalization happens in
   * apply-execution-plan-edit.ts at edit time, never left to whatever case/
   * shorthand the operator typed. Only meaningful when this mapping's own
   * placeholderClassification is "color" (see resolveExecuteFrameDispatch's
   * own gate) - never a silently-fabricated default for an unset color.
   */
  colorHex: z
    .string()
    .regex(/^#[0-9A-F]{6}$/, "colorHex must be canonical #RRGGBB (uppercase)")
    .nullable(),
  /** Explicit SET_LAYER_VISIBILITY intent - null means "no override, leave the layer exactly as authored", never defaulted to true/false. */
  layerVisible: z.boolean().nullable(),
  /** Explicit SET_TIME_REMAP_FREEZE intent (seconds) - null means no freeze-frame override requested for this layer. Never guessed from assetTimestamp or any other field. */
  freezeAtSeconds: z.number().nonnegative().nullable(),
  /**
   * Explicit SET_DURATION intent (seconds) - a LAYER-scoped override,
   * deliberately distinct from the scene-level `finalDuration` above (how
   * long the whole scene stays in the final output). Setting this never
   * derives or mutates the composition's own duration - only the one
   * layer's outPoint, per SET_DURATION's own worker-side contract.
   */
  layerDurationSeconds: z.number().positive().nullable(),
  mappingSource: mappingSourceSchema,
  /** AI-suggestion confidence only - null for MANIFEST/HUMAN mappingSource, never fabricated for those. */
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type PlaceholderMapping = z.infer<typeof placeholderMappingSchema>;

/**
 * One per manifest composition, ALWAYS - including the 20-of-45-style
 * compositions with no detected placeholder detail at all (mappings: []).
 * Never removed just because ae_get_composition lacked layer detail.
 */
export const scenePlanEntrySchema = z.object({
  id: z.string().min(1),
  manifestCompositionId: z.string().min(1),
  compositionName: z.string(),
  use: z.boolean(),
  /** manifest scene.originalOrderIndex - fixed, never re-derived. */
  sourcePosition: z.number().int().nonnegative(),
  /** Null until a human/default assigns it - independent of sourcePosition. */
  finalOrder: z.number().int().nonnegative().nullable(),
  /** Seconds this scene remains in the final output - a scene-level concept, distinct from any mapping's assetTimestamp. */
  finalDuration: z.number().positive().nullable(),
  approvalState: rowApprovalStateSchema,
  instructions: z.string().nullable(),
  notes: z.string().nullable(),
  /** Why this row isn't ready yet, e.g. "no placeholder detected", "composition detail unavailable", "no asset mapped yet" - never silently blank when something is actually missing. */
  unresolvedReasons: z.array(z.string().min(1)),
  /** General supporting evidence for this row as a whole (e.g. manifest facts carried over) - distinct from each mapping's own placeholderClassification.evidence. */
  evidence: z.array(z.string().min(1)),
  mappings: z.array(placeholderMappingSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type ScenePlanEntry = z.infer<typeof scenePlanEntrySchema>;

/**
 * Explicit, human-configured render delivery target for ONE output
 * variant (render-delivery phase section 1) - never guessed from "active
 * comp"/"first comp"/"largest comp"/a filename heuristic. Binds the exact
 * canonical composition identity already established for EXECUTE_FRAME/
 * INSPECT_SCENE_EVIDENCE (manifestCompositionId + aeProjectItemIndex +
 * compositionName - see execute-scene-edit.ts's own doc comment) plus the
 * exact source .aep revision this selection was made against
 * (sourceProjectSha256) - a later mismatch against the plan's own current
 * sourceProjectSha256 makes this configuration STALE (section 3), checked
 * at render-dispatch time, never silently reused across a source change.
 */
export const renderOutputConfigSchema = z.object({
  manifestCompositionId: z.string().min(1),
  aeProjectItemIndex: z.number().int().positive(),
  compositionName: z.string().min(1),
  sourceProjectSha256: z.string().min(1),
  /** AE Render Queue template names (aerender's own -RStemplate/-OMtemplate flags) - explicit, human-supplied text, never a code-side default (see render-project.ts's own doc comment on why no default is assumed). */
  renderSettingsTemplateName: z.string().min(1),
  outputModuleTemplateName: z.string().min(1),
  configuredAt: z.string().datetime()
});
export type RenderOutputConfig = z.infer<typeof renderOutputConfigSchema>;

/** Independent per variant - configuring LANDSCAPE never requires or implies a REELS configuration, and vice versa (section 1: "independent optional configuration"). Reuses render-project.ts's own RenderOutputVariant ("LANDSCAPE"|"REELS") - the one variant vocabulary the whole render pipeline shares, never redeclared. */
export const renderOutputsSchema = z.object({
  LANDSCAPE: renderOutputConfigSchema.nullable(),
  REELS: renderOutputConfigSchema.nullable()
});
export type RenderOutputs = z.infer<typeof renderOutputsSchema>;

export const EMPTY_RENDER_OUTPUTS: RenderOutputs = { LANDSCAPE: null, REELS: null };

export const executionPlanSchema = z.object({
  schemaVersion: z.literal(EXECUTION_PLAN_SCHEMA_VERSION),
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** Increments only on a real content edit - approve/reject/reopen are in-place status transitions on the same revision, never a new one, since the content didn't change. */
  revision: z.number().int().positive(),
  status: planStatusSchema,
  templateId: z.string().min(1),
  /**
   * Binds this plan to the EXACT source .aep revision it was built from
   * (CLAUDE.md Safety Rule 8 / Phase 4's own requirement) - a plan built
   * for one sha256 must never be silently treated as valid for another.
   */
  sourceProjectSha256: z.string().min(1),
  approvedAt: z.string().datetime().nullable(),
  approvedBy: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  scenePlans: z.array(scenePlanEntrySchema),
  renderOutputs: renderOutputsSchema
});
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

/**
 * Flattened Dynamic Scene Table contract (docs/PHASES.md Phase 4's
 * dashboard column list) - one row per PlaceholderMapping, plus one row
 * per ScenePlanEntry with zero mappings (mappingId: null) so a
 * composition-level-only scene is still visible and editable, never
 * dropped from the table. Purely a derived read view - editing always
 * happens through the typed operations in execution-plan-edit.ts, never
 * by writing to this shape directly.
 */
export const sceneTableRowSchema = z.object({
  scenePlanId: z.string().min(1),
  mappingId: z.string().min(1).nullable(),
  use: z.boolean(),
  sourcePosition: z.number().int().nonnegative(),
  finalOrder: z.number().int().nonnegative().nullable(),
  compositionName: z.string(),
  placeholderLabel: z.string().nullable(),
  placeholderClassification: provenanceSchema.nullable(),
  selectedAssetId: z.string().min(1).nullable(),
  selectedAssetType: placeholderTypeSchema.nullable(),
  text: z.string().nullable(),
  assetTimestamp: z.number().nonnegative().nullable(),
  finalDuration: z.number().positive().nullable(),
  approvalState: rowApprovalStateSchema,
  notes: z.string().nullable(),
  instructions: z.string().nullable(),
  unresolvedReasons: z.array(z.string().min(1))
});
export type SceneTableRow = z.infer<typeof sceneTableRowSchema>;
