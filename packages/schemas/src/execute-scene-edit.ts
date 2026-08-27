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
    /** Real file path on the worker's OWN filesystem, already downloaded and sha256-verified by the worker itself - see resolve-scene-edit-operation.ts. Never a URL, never a value that ever crossed the wire from the API - this operation shape is worker-internal only (constructed by the worker after asset resolution), never the dispatch-facing wire contract (see mapFootageOperationIntentSchema below for that). */
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

/**
 * MAP_FOOTAGE's DISPATCH-FACING intent - identifies the project asset to
 * relink to by `assetId` + the exact bytes expected (`expectedSha256`),
 * never a filesystem path of any kind (no browser/API caller, and no
 * server-side dispatch resolver, ever knows or invents a path on the
 * worker's own disk). The worker downloads this asset through its own
 * authenticated `GET /api/workers/:workerId/jobs/:jobId/assets/:assetId/file`
 * call, verifies the received bytes against `expectedSha256`, caches them
 * inside its own job workspace under a name IT derives (never a
 * server-supplied filename), and only then constructs the real, resolved
 * `mapFootageOperationSchema` (with a real local `assetPath`) to hand to
 * the AE edit bridge - see resolve-scene-edit-operation.ts (worker) and
 * resolve-execute-frame-dispatch.ts (API).
 */
const mapFootageOperationIntentSchema = z
  .object({
    type: z.literal("MAP_FOOTAGE"),
    manifestPlaceholderId: z.string().min(1),
    layerIndex: z.number().int().positive(),
    assetId: z.string().uuid(),
    /** The asset's real, server-computed sha256 (AssetRecord.sha256) - the worker refuses to use downloaded bytes that don't match this. */
    expectedSha256: z.string().min(1),
    /** Used only to pick a sensible local file extension for the cached copy - never trusted as a security boundary by itself. */
    mimeType: z.string().min(1)
  })
  .strict();

/**
 * The dispatch-facing (server -> worker) counterpart to
 * sceneEditOperationSchema - identical for every operation type that
 * never touches an asset; only MAP_FOOTAGE differs (intent vs. resolved -
 * see mapFootageOperationIntentSchema's own doc comment). This is what
 * executeSceneEditRequestSchema.operations actually carries; the worker's
 * own executor resolves each intent into a real SceneEditOperation
 * immediately before applying it (see resolve-scene-edit-operation.ts) -
 * ae-edit-bridge.ts/jsx-templates.ts only ever see the resolved shape,
 * never this one.
 */
export const sceneEditOperationIntentSchema = z.discriminatedUnion("type", [
  setTextOperationSchema,
  mapFootageOperationIntentSchema,
  setLayerVisibilityOperationSchema,
  setTimeRemapFreezeOperationSchema,
  setDurationOperationSchema,
  setBrandColorOperationSchema
]);
export type SceneEditOperationIntent = z.infer<typeof sceneEditOperationIntentSchema>;

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
 *
 * Deliberately carries NO `workingProjectPath` (removed 2026-08-27, see
 * apps/worker/src/execution/execute-scene-edit-executor.ts's own doc
 * comment on why): the working copy's real location is entirely the
 * worker's own concern, derived internally from (its own configured
 * workRoot, this job's real jobId) - the API/browser never knows or needs
 * to know that value, and the worker never accepts it as an assertion to
 * verify against. The original-vs-working-copy distinctness safety check
 * (CLAUDE.md Safety Rule 1) is enforced entirely worker-side too (see
 * workspace/working-copy.ts's own SAME_PATH check).
 */
export const executeSceneEditRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    planId: z.string().min(1),
    planRevision: z.number().int().positive(),
    sourceProjectSha256: z.string().min(1),
    sourceProjectPath: z.string().min(1),
    scenePlanId: z.string().min(1),
    manifestCompositionId: z.string().min(1),
    /**
     * The raw, 1-based `app.project.item(n)` position AE itself uses to
     * address this composition - confirmed 2026-08-27 directly from the
     * real upstream host-scripts/ae-mcp-methods.jsx (`resolveComp`: a raw
     * `app.project.item(idx)` lookup across ALL project items - folders,
     * footage, solids, comps - not a 0-based "count only CompItems"
     * index). Named `aeProjectItemIndex` (not `compositionIndex`)
     * specifically so it is never confused with a durable identity -
     * manifestCompositionId is that; this is only ever the short-lived
     * runtime locator AE needs to find the same composition right now, and
     * is verified against `compositionName` below before any mutation
     * (see jsx-templates.ts's own name-verification safety net).
     */
    aeProjectItemIndex: z.number().int().positive(),
    /** The composition's expected real AE name (as last observed/verified) - never trusted alone: the worker-side JSX confirms the resolved CompItem's own `.name` matches this before any mutation is attempted, so a stale/wrong aeProjectItemIndex can never silently target the wrong composition. */
    compositionName: z.string().min(1),
    /** The specific PlaceholderMapping IDs this edit is allowed to act on - every operation's manifestPlaceholderId must be one of these. */
    approvedMappingIds: z.array(z.string().min(1)).min(1),
    operations: z.array(sceneEditOperationIntentSchema).min(1),
    checkpoint: sceneEditCheckpointSchema.nullable()
  })
  .strict();
export type ExecuteSceneEditRequest = z.infer<typeof executeSceneEditRequestSchema>;

/**
 * What a real worker execution reports back - metadata alone is never
 * "success"; a real preview frame is required (Phase 7 acceptance).
 * Extended beyond the original Phase 7A draft (jobId/workerId/
 * sourceProjectSha256/workingProjectPath/workingProjectSha256/
 * startedAt/completedAt) once real execution existed to report against -
 * never exposes an arbitrary/unbounded filesystem path to a
 * browser-facing API by itself; workingProjectPath here is the worker's
 * own job-scoped path, already restricted to its configured work root
 * (see apps/worker/src/workspace/work-root.ts), the same way
 * previewFramePath already was.
 */
export const sceneEditResultSchema = z.object({
  /** Stamped by job-dispatcher.ts after execution, mirroring RawInspectionCapture's own "the executor doesn't know its own job/worker identity" convention - absent until then. */
  jobId: z.string().min(1).optional(),
  workerId: z.string().min(1).optional(),
  scenePlanId: z.string().min(1),
  /** Re-verified from the real file on disk at execution time - never merely echoed back from the request. */
  sourceProjectSha256: z.string().min(1),
  /** Null only when execution failed before a working copy could ever be prepared. */
  workingProjectPath: z.string().min(1).nullable(),
  workingProjectSha256: z.string().min(1).nullable(),
  operationsRequested: z.number().int().nonnegative(),
  operationsCompleted: z.array(z.number().int().nonnegative()),
  checkpoint: sceneEditCheckpointSchema,
  previewFramePath: z.string().min(1).nullable(),
  previewTimestampSeconds: z.number().nonnegative().nullable(),
  failureReason: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime()
});
export type SceneEditResult = z.infer<typeof sceneEditResultSchema>;
