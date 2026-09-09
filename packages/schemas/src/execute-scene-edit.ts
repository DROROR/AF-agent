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
  "SET_BRAND_COLOR",
  "BUILD_REELS_COMPOSITION"
] as const;
export type SceneEditOperationType = (typeof SCENE_EDIT_OPERATION_TYPES)[number];

/**
 * Live QA "generic AE layer-discovery capability" execution-wiring fix
 * (2026-09-08): the EXECUTION-time (dispatch-resolved) counterpart to
 * execution-plan.ts's own NestedTargetStep - identical compositionId/
 * layerIndex meaning (see that schema's own doc comment), PLUS a real,
 * freshly-resolved `aeProjectItemIndex` for THIS step's own composition -
 * resolveExecuteFrameDispatch resolves this from the CURRENT manifest at
 * dispatch time (never persisted, never trusted stale), the exact same way
 * the top-level scene composition's own aeProjectItemIndex already is.
 * This is what lets jsx-templates.ts jump directly to each hop's real
 * composition via `app.project.item(n)` (the same primitive every other
 * script in that file already uses), independently re-verifying its own
 * `.id` against this step's compositionId before ever touching a layer in
 * it - never a single blind walk through `.source` chains, and never a
 * name-only match.
 */
const resolvedNestedTargetStepSchema = z
  .object({
    compositionId: z.string().min(1),
    aeProjectItemIndex: z.number().int().positive(),
    layerIndex: z.number().int().nonnegative()
  })
  .strict();
export type ResolvedNestedTargetStep = z.infer<typeof resolvedNestedTargetStepSchema>;

// Every operation targets one layer by BOTH manifestPlaceholderId (the
// stable, evidence-backed identity from the manifest) AND layerIndex (the
// real AE layer.index within the composition) - never a free-form
// property path, never a layer resolved by name alone (duplicate layer
// names are explicitly supported elsewhere in this project).
//
// Live QA execution-wiring fix (2026-09-08): manifestPlaceholderId/
// layerIndex are now BOTH nullable, and a new optional `nestedTarget` was
// added, so a human-added mapping (execution-plan.ts's own
// humanLayerIndex/humanNestedTarget - manifestPlaceholderId: null on the
// mapping itself, no manifest Placeholder record to supply a flat
// layerIndex) can also become a real, dispatchable operation. Exactly one
// of layerIndex/nestedTarget is ever non-null (enforced in
// resolve-execute-frame-dispatch.ts, the same "outside the schema" pattern
// ADD_MAPPING's own humanLayerIndex/humanNestedTarget mutual exclusivity
// already uses - z.discriminatedUnion members reject .refine()).
// Every EXISTING caller that always supplies a non-null manifestPlaceholderId
// + non-null layerIndex + omits nestedTarget is completely unaffected -
// this is a strictly additive widening, never a behavior change for the
// manifest-linked path.
const setTextOperationSchema = z
  .object({
    type: z.literal("SET_TEXT"),
    manifestPlaceholderId: z.string().min(1).nullable(),
    layerIndex: z.number().int().positive().nullable(),
    nestedTarget: z.array(resolvedNestedTargetStepSchema).min(1).nullable(),
    text: z.string().min(1)
  })
  .strict();

const mapFootageOperationSchema = z
  .object({
    type: z.literal("MAP_FOOTAGE"),
    manifestPlaceholderId: z.string().min(1).nullable(),
    layerIndex: z.number().int().positive().nullable(),
    nestedTarget: z.array(resolvedNestedTargetStepSchema).min(1).nullable(),
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

/**
 * ONE layer's explicit, human-reviewed reposition/scale target within the
 * new Reels composition BUILD_REELS_COMPOSITION creates (2026-08-29
 * closure requirement, section 1: "layout values must come from
 * human-reviewed persisted intent... no AI guessing coordinates at
 * execution time"). `positionX`/`positionY` are native AE pixel
 * coordinates within the fixed 1080x1920 Reels frame; `scalePercent` is
 * AE's own native uniform Transform > Scale percentage (100 = unchanged).
 * Every value here is a plain, already-approved number from the execution
 * plan's own persisted reelsLayout (execution-plan.ts) - never computed or
 * guessed by this worker at execution time.
 */
export const layerTransformSchema = z
  .object({
    layerIndex: z.number().int().positive(),
    manifestPlaceholderId: z.string().min(1).nullable(),
    positionX: z.number(),
    positionY: z.number(),
    scalePercent: z.number().positive()
  })
  .strict();
export type LayerTransform = z.infer<typeof layerTransformSchema>;

/**
 * Builds the native 1080x1920 Reels composition for THIS scene (client
 * closure requirement, section 1) - a comp-level operation (no single
 * `layerIndex`/`manifestPlaceholderId` of its own, unlike every other
 * operation above), always the LAST operation in a scene's own operations
 * array so it duplicates the scene's landscape composition AFTER that same
 * job's own content operations (SET_TEXT/MAP_FOOTAGE/etc.) have already
 * been applied to it - the duplicate therefore carries the real, approved
 * content, not template placeholder text. Never a crop: the worker-side
 * JSX (jsx-templates.ts) uses AE's native CompItem.duplicate() (which
 * copies every layer, effect, and keyframe verbatim), resizes ONLY the
 * duplicate to the fixed 1080x1920 frame, then repositions/rescales each
 * named layer to its own explicit `layerTransforms` target - the original
 * landscape composition is never touched. If a target layer's position or
 * scale already carries real keyframe animation, that layer's transform is
 * refused with a typed failure rather than silently destroying the
 * animation (CLAUDE.md/closure requirement: "preserve original template
 * animation/structure"). If a composition named `reelsCompositionName`
 * already exists (a prior run of this same scene), it is removed first so
 * re-execution never accumulates stale duplicate compositions.
 */
const buildReelsCompositionOperationSchema = z
  .object({
    type: z.literal("BUILD_REELS_COMPOSITION"),
    /** Human-chosen, explicit, persisted name for the new duplicate composition - never auto-generated or guessed. */
    reelsCompositionName: z.string().min(1),
    layerTransforms: z.array(layerTransformSchema).min(1)
  })
  .strict();
export type BuildReelsCompositionOperation = z.infer<typeof buildReelsCompositionOperationSchema>;

export const sceneEditOperationSchema = z.discriminatedUnion("type", [
  setTextOperationSchema,
  mapFootageOperationSchema,
  setLayerVisibilityOperationSchema,
  setTimeRemapFreezeOperationSchema,
  setDurationOperationSchema,
  setBrandColorOperationSchema,
  buildReelsCompositionOperationSchema
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
    manifestPlaceholderId: z.string().min(1).nullable(),
    layerIndex: z.number().int().positive().nullable(),
    nestedTarget: z.array(resolvedNestedTargetStepSchema).min(1).nullable(),
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
  setBrandColorOperationSchema,
  buildReelsCompositionOperationSchema
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
 * workRoot, `executionSessionId` below) - the API/browser never knows or
 * needs to know that value, and the worker never accepts it as an
 * assertion to verify against. The original-vs-working-copy distinctness
 * safety check (CLAUDE.md Safety Rule 1) is enforced entirely worker-side
 * too (see workspace/working-copy.ts's own SAME_PATH check).
 *
 * `executionSessionId` + `expectedWorkingProjectSha256` (multi-scene-
 * accumulation phase, section 6/9) replace the OLD job-scoped-working-copy
 * model: the working copy is now keyed by the SESSION, not this job's own
 * jobId, so scene 2's edit lands in the SAME file scene 1's edit produced.
 * `expectedWorkingProjectSha256` is null only for a session's very first
 * scene job (no working copy exists yet, so there is nothing to chain
 * from); for every later job it is the session's own
 * latestWorkingProjectSha256 as last durably recorded by the API - the
 * worker fails closed (WORKING_COPY_MISSING/WORKING_COPY_SHA_MISMATCH,
 * see sceneEditResultSchema below) rather than silently recreating the
 * working copy from the original source if this ever disagrees with what
 * is actually on disk (section 6's "chain of custody").
 */
export const executeSceneEditRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    planId: z.string().min(1),
    planRevision: z.number().int().positive(),
    sourceProjectSha256: z.string().min(1),
    sourceProjectPath: z.string().min(1),
    executionSessionId: z.string().uuid(),
    expectedWorkingProjectSha256: z.string().min(1).nullable(),
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
    approvedMappingIds: z.array(z.string().min(1)),
    operations: z.array(sceneEditOperationIntentSchema),
    checkpoint: sceneEditCheckpointSchema.nullable(),
    /**
     * Live QA fix (2026-09-08/09, First Preview regeneration): opt-in
     * intent flag only, omitted/false for every existing caller and
     * preserving the exact prior behavior (operations/approvedMappingIds
     * both required non-empty below). When true, this job must make NO
     * edit at all - operations/approvedMappingIds must both be exactly
     * empty - and instead opens the session's already-mutated working
     * copy (expectedWorkingProjectSha256 must be set - there is never a
     * "first" previewOnly job) purely to recapture a fresh First Preview
     * frame at `previewTimestampSeconds`, e.g. after the operator rejected
     * one captured at an unrepresentative moment (real incident: t=0
     * landed on a solid background color, before any branding was ever
     * visible). See resolveExecuteFrameDispatch's own previewOnly branch
     * and recordRegeneratePreviewResultIfApplicable (apps/api) for the
     * dispatch-time preconditions and the session-status transition this
     * enables - never a path to re-running MAP_FOOTAGE/SET_TEXT.
     *
     * MUST BE READ-ONLY WITH RESPECT TO THE .aep FILE (2026-09-09
     * correction to the fix above): the worker never calls
     * app.project.save() for previewOnly - AE's own save unconditionally
     * re-serializes the entire binary, which measurably changes its
     * sha256 even with zero real content changes (the exact real
     * incident: workingProjectSha256 changed from a previewOnly run that
     * requested no operations at all). The preview frame itself is
     * captured via the separate, genuinely read-only `ae_capture_frame`
     * tool, which never required a save to begin with.
     */
    previewOnly: z.boolean().optional(),
    /**
     * Only meaningful when previewOnly is true - the real, controlled
     * capture time (section 13: "a controlled frame time"), never guessed
     * by the worker itself. Omitted/undefined for a normal (previewOnly
     * false/omitted) job preserves the exact prior fixed t=0 behavior -
     * see execute-scene-edit-executor.ts's own PREVIEW_TIMESTAMP_SECONDS.
     */
    previewTimestampSeconds: z.number().nonnegative().finite().optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.previewOnly === true) {
      if (value.operations.length !== 0 || value.approvedMappingIds.length !== 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "previewOnly must carry zero operations and zero approvedMappingIds - it never edits anything" });
      }
      if (value.expectedWorkingProjectSha256 === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "previewOnly requires an existing working copy (expectedWorkingProjectSha256) - there is never a first previewOnly job" });
      }
    } else if (value.operations.length === 0 || value.approvedMappingIds.length === 0) {
      // The exact prior invariant (operations.min(1)/approvedMappingIds.min(1))
      // - preserved as a refine rather than a raw .min(1) only so previewOnly
      // can legitimately be the one, explicit exception above.
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "operations and approvedMappingIds must both be non-empty unless previewOnly is true" });
    }
  });
export type ExecuteSceneEditRequest = z.infer<typeof executeSceneEditRequestSchema>;

/**
 * A working-copy chain-of-custody failure specifically (section 7/6) -
 * distinct from an ordinary operation/AE failure so the API can react
 * programmatically (mark the execution session FAILED, never silently
 * recreate the working copy from the original source) rather than pattern-
 * matching prose in `failureReason`. WORKING_COPY_MISSING: the session's
 * working copy is expected to already exist (expectedWorkingProjectSha256
 * was non-null) but no file was found on disk. WORKING_COPY_SHA_MISMATCH:
 * a file exists but its real sha256 does not match what the session's own
 * durable record expected - the on-disk state has diverged from what the
 * API believes happened.
 */
/**
 * Live QA CRITICAL SAFETY FIX (2026-09-08, real incident): a real
 * EXECUTE_FRAME job saved its mutations over the IMMUTABLE SOURCE .aep
 * instead of the intended session working copy, because AeEditBridge
 * mutates "whatever project is currently open in AE" and nothing ever
 * explicitly opened the working copy first (CLAUDE.md Safety Rule 1
 * violation). Three new codes close this class of gap, all following the
 * SAME "never silently continue, mark the session FAILED via the
 * existing recordExecuteFrameResultIfApplicable wiring" pattern
 * WORKING_COPY_MISSING/WORKING_COPY_SHA_MISMATCH already use - no new
 * session-status plumbing needed, only new, more specific reasons a job
 * (and therefore its session) can be FAILED:
 *   - WORKING_COPY_NOT_OPENED: the worker could not confirm AE has the
 *     exact session working-copy path open (the open-project script
 *     failed, or AE reports a different path than expected) - fails
 *     BEFORE any operation is ever attempted.
 *   - SOURCE_PROJECT_MUTATED: the immutable source .aep's own real,
 *     freshly-read sha256 no longer matches its expected value AFTER this
 *     job's own operations/save - the exact signal that caught the real
 *     incident this fix responds to. The single most severe of these
 *     three - a genuine Safety Rule 1 violation already happened, not
 *     merely an execution-state inconsistency.
 *   - WORKING_COPY_UNCHANGED_AFTER_MUTATION: one or more operations
 *     reported successful completion, but the saved working copy's own
 *     sha256 is byte-identical to what it was before those operations ran
 *     - suspicious by construction (a real content mutation should always
 *     change SOME bytes of a real binary project file) and never treated
 *     as a legitimate "no-op" success.
 *
 * A fourth code, added for First Preview regeneration (live QA,
 * 2026-09-08/09):
 *   - WORKING_COPY_UNEXPECTEDLY_MUTATED: the mirror image of
 *     WORKING_COPY_UNCHANGED_AFTER_MUTATION, for a `previewOnly` job
 *     specifically - zero operations were requested (previewOnly means
 *     "recapture a frame, never edit anything"), so the saved working
 *     copy's sha256 must stay byte-identical to what it was before this
 *     run. If it changed anyway, something mutated the working copy
 *     outside this job's own knowledge - never treated as a safe preview
 *     recapture.
 */
export const WORKING_COPY_FAILURE_CODES = [
  "WORKING_COPY_MISSING",
  "WORKING_COPY_SHA_MISMATCH",
  "WORKING_COPY_NOT_OPENED",
  "SOURCE_PROJECT_MUTATED",
  "WORKING_COPY_UNCHANGED_AFTER_MUTATION",
  "WORKING_COPY_UNEXPECTEDLY_MUTATED"
] as const;
export type WorkingCopyFailureCode = (typeof WORKING_COPY_FAILURE_CODES)[number];
export const workingCopyFailureCodeSchema = z.enum(WORKING_COPY_FAILURE_CODES);

/**
 * The subset of WORKING_COPY_FAILURE_CODES that prove the session's
 * WORKING COPY ITSELF (as opposed to the immutable source, or merely a
 * suspicious-but-not-necessarily-diverged operation application) is no
 * longer trustworthy for future use - live QA, 2026-09-09, session
 * 5040ce97: WORKING_COPY_UNEXPECTEDLY_MUTATED fired, proving the real
 * file on disk had diverged from the session's own recorded
 * latestWorkingProjectSha256, while every OTHER field on that session
 * still looked perfectly "recoverable". Shared by both
 * recordExecuteFrameResultIfApplicable and
 * recordRegeneratePreviewResultIfApplicable (apps/api) so the exact same
 * set is used everywhere workingCopyTrusted is ever set to false -
 * deliberately excludes SOURCE_PROJECT_MUTATED (about the source, not
 * this session's working copy) and WORKING_COPY_UNCHANGED_AFTER_MUTATION
 * (the working copy's bytes are unchanged from what's recorded - not
 * proven to have diverged, merely suspicious that real edits landed).
 */
export const WORKING_COPY_DISTRUST_FAILURE_CODES = [
  "WORKING_COPY_MISSING",
  "WORKING_COPY_SHA_MISMATCH",
  "WORKING_COPY_UNEXPECTEDLY_MUTATED"
] as const satisfies readonly WorkingCopyFailureCode[];

/**
 * What a real worker execution reports back - metadata alone is never
 * "success"; a real preview frame is required (Phase 7 acceptance).
 * Extended beyond the original Phase 7A draft (jobId/workerId/
 * sourceProjectSha256/workingProjectPath/workingProjectSha256/
 * startedAt/completedAt) once real execution existed to report against -
 * never exposes an arbitrary/unbounded filesystem path to a
 * browser-facing API by itself; workingProjectPath here is the worker's
 * own session-scoped path, already restricted to its configured work root
 * (see apps/worker/src/workspace/work-root.ts), the same way
 * previewFramePath already was. `executionSessionId` is simply echoed back
 * from the request (never invented worker-side) so the API can update the
 * correct session's durable record without needing to parse job.payload.
 */
export const sceneEditResultSchema = z.object({
  /** Stamped by job-dispatcher.ts after execution, mirroring RawInspectionCapture's own "the executor doesn't know its own job/worker identity" convention - absent until then. */
  jobId: z.string().min(1).optional(),
  workerId: z.string().min(1).optional(),
  executionSessionId: z.string().uuid(),
  scenePlanId: z.string().min(1),
  /** Re-verified from the real file on disk at execution time - never merely echoed back from the request. */
  sourceProjectSha256: z.string().min(1),
  /** Null only when execution failed before a working copy could ever be prepared/verified. */
  workingProjectPath: z.string().min(1).nullable(),
  workingProjectSha256: z.string().min(1).nullable(),
  /** Non-null only for a working-copy chain-of-custody failure (section 7) - null for every other outcome, including success. */
  workingCopyFailureCode: workingCopyFailureCodeSchema.nullable(),
  operationsRequested: z.number().int().nonnegative(),
  operationsCompleted: z.array(z.number().int().nonnegative()),
  checkpoint: sceneEditCheckpointSchema,
  previewFramePath: z.string().min(1).nullable(),
  previewTimestampSeconds: z.number().nonnegative().nullable(),
  /**
   * Non-null only when this job's operations included a successfully
   * completed BUILD_REELS_COMPOSITION (2026-08-29 closure requirement) -
   * the new composition's real, worker-verified identity (read back from
   * the actual AE CompItem, never assumed), so the API can safely register
   * it as an additive derived composition on the project's manifest (see
   * register-reels-composition.ts) without any DB/curl access.
   * `manifestCompositionId` is deliberately absent here: the worker never
   * invents a canonical manifest identity - that is the API's own concern.
   */
  reelsCompositionBuilt: z
    .object({
      aeProjectItemIndex: z.number().int().positive(),
      compositionName: z.string().min(1),
      widthPx: z.number().int().positive(),
      heightPx: z.number().int().positive(),
      durationSeconds: z.number().nonnegative(),
      frameRate: z.number().positive()
    })
    .nullable()
    .default(null),
  failureReason: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime()
});
export type SceneEditResult = z.infer<typeof sceneEditResultSchema>;
