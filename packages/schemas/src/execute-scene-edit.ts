import { z } from "zod";

/**
 * Phase 7A foundation: the strict, allowlisted contract for a future
 * single-scene deterministic AE edit. Nothing in this file is wired to
 * any route or worker execution yet - control-plane contract only (no
 * AE mutation exists behind this today). The real WorkerCapability this
 * will eventually dispatch as is "EXECUTE_FRAME" (already in
 * WORKER_CAPABILITIES - worker.ts / CLAUDE.md's fixed allowlist), not a
 * new capability name - "EXECUTE_SCENE_EDIT" below refers only to this
 * request/payload shape, never a second operation vocabulary.
 *
 * Every operation below is a narrow, single-property, structurally
 * describable AE action (set sourceText, relink a footage source, toggle
 * layer.enabled, add one time-remap keyframe pair, adjust outPoint,
 * set a fill color) - never arbitrary JSX/ExtendScript text, never a
 * free-form property path, never an arbitrary MCP tool name. The actual
 * worker-side JSX that performs each of these does not exist yet (that is
 * separate, later work) - this schema exists so that work has a real,
 * reviewed contract to implement against, rather than inventing one at
 * execution time.
 */
export const SCENE_EDIT_OPERATION_TYPES = [
  "SET_TEXT",
  "MAP_FOOTAGE",
  "SET_LAYER_VISIBILITY",
  "SET_TIME_REMAP_FREEZE",
  "SET_DURATION",
  "SET_BRAND_COLOR"
] as const;
export type SceneEditOperationType = (typeof SCENE_EDIT_OPERATION_TYPES)[number];

// Every operation targets one layer by BOTH manifestPlaceholderId (the
// stable, evidence-backed identity from the manifest) AND layerIndex (the
// real AE layer.index within the composition) - never a free-form
// property path, never a layer resolved by name alone (duplicate layer
// names are explicitly supported elsewhere in this project).
const setTextOperationSchema = z
  .object({
    type: z.literal("SET_TEXT"),
    manifestPlaceholderId: z.string().min(1),
    layerIndex: z.number().int().positive(),
    text: z.string().min(1)
  })
  .strict();

const mapFootageOperationSchema = z
  .object({
    type: z.literal("MAP_FOOTAGE"),
    manifestPlaceholderId: z.string().min(1),
    layerIndex: z.number().int().positive(),
    /** Real file path on the worker's own filesystem to relink this layer's footage source to - never a URL, never fetched by the worker itself. */
    assetPath: z.string().min(1)
  })
  .strict();

const setLayerVisibilityOperationSchema = z
  .object({
    type: z.literal("SET_LAYER_VISIBILITY"),
    manifestPlaceholderId: z.string().min(1),
    layerIndex: z.number().int().positive(),
    visible: z.boolean()
  })
  .strict();

const setTimeRemapFreezeOperationSchema = z
  .object({
    type: z.literal("SET_TIME_REMAP_FREEZE"),
    manifestPlaceholderId: z.string().min(1),
    layerIndex: z.number().int().positive(),
    freezeAtSeconds: z.number().nonnegative()
  })
  .strict();

const setDurationOperationSchema = z
  .object({
    type: z.literal("SET_DURATION"),
    manifestPlaceholderId: z.string().min(1),
    layerIndex: z.number().int().positive(),
    durationSeconds: z.number().positive()
  })
  .strict();

const setBrandColorOperationSchema = z
  .object({
    type: z.literal("SET_BRAND_COLOR"),
    manifestPlaceholderId: z.string().min(1),
    layerIndex: z.number().int().positive(),
    /** #RRGGBB only - never a named color, never a raw AE color-array literal from the caller. */
    colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "colorHex must be #RRGGBB")
  })
  .strict();

export const sceneEditOperationSchema = z.discriminatedUnion("type", [
  setTextOperationSchema,
  mapFootageOperationSchema,
  setLayerVisibilityOperationSchema,
  setTimeRemapFreezeOperationSchema,
  setDurationOperationSchema,
  setBrandColorOperationSchema
]);
export type SceneEditOperation = z.infer<typeof sceneEditOperationSchema>;

/** Resumability state - which requested operations (by array index) already completed, so a re-attempt never blindly restarts from operation 0. */
export const sceneEditCheckpointSchema = z.object({
  completedOperationIndices: z.array(z.number().int().nonnegative()),
  checkpointBeforeAt: z.string().datetime().nullable(),
  checkpointAfterAt: z.string().datetime().nullable(),
  failureReason: z.string().nullable()
});
export type SceneEditCheckpoint = z.infer<typeof sceneEditCheckpointSchema>;

/**
 * The full EXECUTE_SCENE_EDIT request - derived ONLY from an approved
 * execution-plan revision (planId/planRevision/sourceProjectSha256 all
 * pinned explicitly, never re-resolved live at dispatch time - see
 * validate-scene-edit-preconditions.ts for what checks this against).
 * workingProjectPath must differ from sourceProjectPath - the original
 * .aep is never a mutation target (CLAUDE.md Safety Rule 1).
 */
export const executeSceneEditRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    planId: z.string().min(1),
    planRevision: z.number().int().positive(),
    sourceProjectSha256: z.string().min(1),
    sourceProjectPath: z.string().min(1),
    workingProjectPath: z.string().min(1),
    scenePlanId: z.string().min(1),
    manifestCompositionId: z.string().min(1),
    /** The specific PlaceholderMapping IDs this edit is allowed to act on - every operation's manifestPlaceholderId must be one of these. */
    approvedMappingIds: z.array(z.string().min(1)).min(1),
    operations: z.array(sceneEditOperationSchema).min(1),
    checkpoint: sceneEditCheckpointSchema.nullable()
  })
  .strict()
  .refine((data) => data.workingProjectPath !== data.sourceProjectPath, {
    message: "workingProjectPath must differ from sourceProjectPath - the original .aep is never a mutation target",
    path: ["workingProjectPath"]
  });
export type ExecuteSceneEditRequest = z.infer<typeof executeSceneEditRequestSchema>;

/** What a real worker execution would report back - metadata alone is never "success"; a real preview frame is required (Phase 7 acceptance). */
export const sceneEditResultSchema = z.object({
  scenePlanId: z.string().min(1),
  operationsRequested: z.number().int().nonnegative(),
  operationsCompleted: z.array(z.number().int().nonnegative()),
  checkpoint: sceneEditCheckpointSchema,
  previewFramePath: z.string().min(1).nullable(),
  previewTimestampSeconds: z.number().nonnegative().nullable(),
  failureReason: z.string().nullable()
});
export type SceneEditResult = z.infer<typeof sceneEditResultSchema>;
