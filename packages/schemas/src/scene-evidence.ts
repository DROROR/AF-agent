import { z } from "zod";

/**
 * Request/response contract for the INSPECT_SCENE_EVIDENCE worker
 * operation (Phase 7B). Read-only: only reachable via
 * HeroicSwanMcpClient's allowlisted ae_get_composition/ae_get_layer/
 * ae_capture_frame tools (see heroic-swan-mcp-client.ts), scoped to ONE
 * named composition and a bounded set of its layers. Never mutates,
 * saves, or renders the source project - CLAUDE.md Safety Rules 1-3.
 *
 * This exists because, per a full read of the real upstream
 * HeroicSwan/after-effects-mcp host script (host-scripts/ae-mcp-methods.jsx,
 * confirmed 2026-08-26), no existing read-only tool exposes real layer
 * TYPE (TextLayer/ShapeLayer/AVLayer/Camera/Light), a layer's source item
 * identity/dimensions/duration, or a text layer's sourceText value. Those
 * facts stay null in LayerEvidence below - never guessed from a layer or
 * composition's display name.
 */

export const MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST = 20;

/**
 * Preview Timing Analysis (live QA, 2026-09-10): the maximum number of
 * distinct INSPECT_SCENE_EVIDENCE dispatches one "Analyze Preview Timing"
 * run may issue - bounds an otherwise arbitrary-depth nested-target chain
 * walk (see derivePreviewTimingTargets's own doc comment) the same way
 * MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST already bounds layerIndices per
 * request. No real template needs anywhere close to this many distinct
 * compositions across one scene's own approved mappings' nested chains.
 */
export const MAX_PREVIEW_TIMING_CHAIN_TARGETS = 20;

export const sceneEvidenceRequestSchema = z
  .object({
    sourceProjectPath: z.string().min(1),
    /**
     * The exact sha256 this evidence is expected to be captured against
     * (typically the manifest's own sourceProject.sha256) - CLAUDE.md
     * Safety Rule 8 ("hash source .aep files ... verify originals remain
     * unchanged"). The worker re-hashes sourceProjectPath itself and
     * refuses to report evidence if it no longer matches, rather than
     * silently describing a project that has since changed.
     */
    sourceProjectSha256: z.string().length(64),
    manifestCompositionId: z.string().min(1),
    /**
     * The raw, 1-based `app.project.item(n)` position AE itself uses to
     * address this composition - the exact same convention
     * `ae_get_composition`/`ae_get_layer`'s own `comp_index` argument
     * expects (confirmed 2026-08-27 directly from the real upstream
     * host-scripts/ae-mcp-methods.jsx). Named `aeProjectItemIndex` (not
     * `compositionIndex`) so it is never confused with a durable identity -
     * manifestCompositionId is that; this is only the short-lived runtime
     * locator, verified against `compositionName` below before any
     * evidence is reported as fact.
     */
    aeProjectItemIndex: z.number().int().positive(),
    /** The composition's expected real AE name (as last observed) - the inspector confirms the resolved composition's own name matches this before reporting evidence, so a stale/wrong aeProjectItemIndex is never silently reported as fact about the wrong composition. */
    compositionName: z.string().min(1),
    /** Empty when the composition has no editable placeholders (or none were classified) - a real representative frame can still be captured via previewTimestampSeconds below regardless (live QA Blocker 2 fix, 2026-09-07; see resolve-inspect-scene-evidence-dispatch.ts's own doc comment). Backward-compatible widening: every request that previously required at least one index remains valid. */
    layerIndices: z.array(z.number().int().positive()).max(MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST),
    /** When set, captures exactly one read-only preview frame at this timestamp via ae_capture_frame. Optional: evidence can be gathered without a preview. */
    previewTimestampSeconds: z.number().nonnegative().nullable().default(null),
    /**
     * Live-QA "generic AE layer-discovery capability" requirement: opt-in
     * (never required, never on by default - every existing caller/test
     * that omits this keeps getting exactly the same `layers`/`preview`
     * behavior as before). When true, the worker ALSO runs the one
     * additional fixed, versioned, read-only JSX script
     * (buildInspectCompositionLayerDetailsScript, via the SAME
     * `runFixedInspectionScript`/ae_run_jsx channel
     * buildInspectCompositionPrecompsScript already uses for INSPECT_
     * TEMPLATE's own nesting facts - see that method's own doc comment for
     * why this is still not "arbitrary JSX") against THIS composition,
     * reporting real layer TYPE, real `sourceText` for text layers, and
     * real source-composition identity for precomp/nested-reference
     * layers - the facts `layers`/LayerEvidence above cannot supply (see
     * this module's own doc comment). Never composition/template-specific:
     * this same flag works against any composition in any supported
     * template's manifest.
     */
    discoverLayerDetails: z.boolean().optional()
  })
  .strict();
export type SceneEvidenceRequest = z.infer<typeof sceneEvidenceRequestSchema>;

/** Every LayerEvidence entry's provenance - always AE_GET_LAYER today, kept as an enum (not a bare literal) so a future genuinely-new read-only source can be added without reshaping every existing field. */
export const LAYER_EVIDENCE_SOURCES = ["AE_GET_LAYER"] as const;
export const layerEvidenceSourceSchema = z.enum(LAYER_EVIDENCE_SOURCES);

export const layerEvidenceSchema = z
  .object({
    layerIndex: z.number().int().positive(),
    name: z.string(),
    enabled: z.boolean(),
    nullLayer: z.boolean(),
    threeDLayer: z.boolean(),
    inPointSeconds: z.number(),
    outPointSeconds: z.number(),
    startTimeSeconds: z.number(),
    /** The parent layer's NAME (ae_get_layer's real response identifies a parent by name, not index), or null if unparented. */
    parentLayerName: z.string().nullable(),
    opacityPercent: z.number().nullable(),
    /**
     * Always null today (see module doc comment): no allowlisted
     * read-only AE tool exposes layer type, source item identity/
     * dimensions/duration, or a text layer's real value. Kept as explicit
     * fields rather than omitted, so a consumer sees exactly what remains
     * unknown instead of inferring "not asked" from absence.
     */
    layerType: z.null(),
    sourceItemName: z.null(),
    sourceWidthPx: z.null(),
    sourceHeightPx: z.null(),
    sourceDurationSeconds: z.null(),
    textValue: z.null(),
    nestedCompositionId: z.null(),
    evidenceSource: layerEvidenceSourceSchema
  })
  .strict();
export type LayerEvidence = z.infer<typeof layerEvidenceSchema>;

/**
 * Live-QA "generic AE layer-discovery capability" requirement - one
 * layer's real, worker-observed classification fact, returned only when
 * `discoverLayerDetails` was requested (see sceneEvidenceRequestSchema
 * above). Populated from buildInspectCompositionLayerDetailsScript's own
 * result, never inferred from a layer's display name.
 */
export const LAYER_TYPE_CLASSIFICATIONS = ["TEXT", "PRECOMP", "AV", "OTHER"] as const;
export type LayerTypeClassification = (typeof LAYER_TYPE_CLASSIFICATIONS)[number];
export const layerTypeClassificationSchema = z.enum(LAYER_TYPE_CLASSIFICATIONS);

export const layerDetailFactSchema = z
  .object({
    layerIndex: z.number().int().positive(),
    layerName: z.string(),
    layerType: layerTypeClassificationSchema,
    /** Real `layer.sourceText.value.text` - only ever non-null when layerType === "TEXT". */
    sourceText: z.string().nullable(),
    /** Real `"comp-" + layer.source.id` - only ever non-null when layerType === "PRECOMP". Same identity convention the manifest's own compositionId already uses, so this composes directly with it. */
    sourceCompositionId: z.string().nullable(),
    /**
     * Preview Timing Analysis (live QA, 2026-09-09) - real `layer.stretch`
     * (percent, AE default 100). Null when the property could not be read
     * (see jsx-templates.ts's own try/catch). Also accepts the key being
     * ABSENT entirely (`.optional()`, normalized to null by the transform
     * below) - a real incident the same day found a Worker still running
     * the pre-extension buildInspectCompositionLayerDetailsScript (an API/
     * Worker version-skew window during a rolling deploy, not a data
     * error) omits this key from its JSON entirely, which a plain
     * `.nullable()` (requires the key to be present, just allows it to be
     * null) hard-fails on. Both "absent" and "explicit null" mean exactly
     * the same thing to every consumer - "this Worker could not report a
     * real value" - so both normalize to the same `null` here rather than
     * forcing every consumer to separately handle `undefined`.
     */
    stretchPercent: z
      .number()
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    /**
     * Preview Timing Analysis (live QA, 2026-09-09) - real
     * `layer.timeRemapEnabled`. Null when the property could not be read
     * (e.g. a layer type that doesn't support time remap). Also accepts
     * the key being ABSENT (see stretchPercent's own doc comment above for
     * why - the identical real incident and the identical normalization).
     */
    timeRemapEnabled: z
      .boolean()
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    /**
     * Preview Timing Analysis (live QA, 2026-09-10 real incident, session
     * a7fee3d9, recommended timestamp 4.93827160493827s): a recommended
     * timestamp fell inside a text layer's confirmed inPoint/outPoint
     * window, yet the rendered frame showed no text - the layer's real
     * opacity was 0. Real `layer.opacity.value`, but ONLY when
     * `layer.opacity.numKeys === 0` (not animated) - null whenever the
     * layer IS animated (see `opacityKeyframes` below, mutually exclusive
     * with this field) or the property could not be read. Absent key
     * normalized to null (same Worker/API version-skew tolerance as
     * stretchPercent/timeRemapEnabled above).
     */
    opacityStatic: z
      .number()
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    /**
     * Preview Timing Analysis (live QA, 2026-09-10) - the REAL, ordered
     * keyframe list (`layer.opacity.keyTime`/`keyValue` for every key 1..
     * `numKeys`) when `layer.opacity.numKeys > 0` - never a single sampled
     * value standing in for a layer that actually fades. Each keyframe's
     * `timeSeconds` is in the layer's own containing composition's
     * timeline, the same convention `inPointSeconds`/`outPointSeconds`
     * already use, so it composes directly with them. Null whenever the
     * layer is NOT animated (mutually exclusive with `opacityStatic`
     * above) or the property could not be read. Absent key normalized to
     * null (same version-skew tolerance as the other Preview Timing
     * Analysis fields).
     */
    opacityKeyframes: z
      .array(z.object({ timeSeconds: z.number(), valuePercent: z.number() }).strict())
      .nullable()
      .optional()
      .transform((value) => value ?? null)
  })
  .strict();
export type LayerDetailFact = z.infer<typeof layerDetailFactSchema>;

export const scenePreviewSchema = z
  .object({
    timestampSeconds: z.number().nonnegative(),
    /** Absolute path on the WORKER's own filesystem (ae-mcp's own ~/.ae-mcp/previews/ directory) - the worker process and ae-mcp are co-located on the same Windows machine, so this path is directly readable by the worker. Never copied/uploaded anywhere by this contract. */
    path: z.string().min(1),
    /**
     * The file's real size in bytes, verified by this worker's own
     * filesystem stat call - never trusted from AE's self-reported value
     * alone ("actual verified image existence", Phase 7B section 7).
     * Always > 0: a zero-byte or missing file is a capture failure, not a
     * success with an empty preview.
     */
    bytes: z.number().int().positive()
  })
  .strict();
export type ScenePreview = z.infer<typeof scenePreviewSchema>;

export const sceneEvidenceResponseSchema = z
  .object({
    /** Confirmed to match the request's sourceProjectSha256 before this response was ever built - see heroic-swan-scene-evidence-inspector.ts. */
    verifiedSourceProjectSha256: z.string().length(64),
    manifestCompositionId: z.string().min(1),
    /** Echoed from the request's own aeProjectItemIndex - the runtime locator this evidence was actually captured against. */
    aeProjectItemIndex: z.number().int().positive(),
    /** The composition's REAL, observed name at capture time (confirmed to match the request's expected compositionName before this response was ever built - see heroic-swan-scene-evidence-inspector.ts). */
    compositionName: z.string(),
    layers: z.array(layerEvidenceSchema),
    /** Null whenever previewTimestampSeconds was not requested, or the capture attempt failed - a failed preview never fails the whole evidence result (layer facts are still useful on their own). */
    preview: scenePreviewSchema.nullable(),
    /** Present only when a preview was requested but could not be captured - kept distinct from `preview: null` meaning "not requested". */
    previewFailureReason: z.string().nullable(),
    /** Null whenever discoverLayerDetails was not requested, or the script call failed - a failed layer-detail discovery never fails the whole evidence result (see layerDetailsFailureReason below). Non-null (possibly empty) array on success. */
    layerDetails: z.array(layerDetailFactSchema).nullable(),
    /** Present only when discoverLayerDetails was requested but the script call could not complete - kept distinct from `layerDetails: null` meaning "not requested". */
    layerDetailsFailureReason: z.string().nullable(),
    capturedAt: z.string().datetime()
  })
  .strict();
export type SceneEvidenceResponse = z.infer<typeof sceneEvidenceResponseSchema>;

/**
 * Per-scene evidence availability, computed against the project's CURRENT
 * sourceProjectSha256 - never a claim that any evidence exists at all.
 * AVAILABLE: a compatible (SHA-matching) record exists and is used as FACT
 * input to the Mapping Assistant. STALE: evidence exists for this scene but
 * was captured against a different source SHA (the project's .aep changed
 * since) - retained historically, never used as current fact. NOT_INSPECTED:
 * no evidence has ever been captured for this scene.
 */
export const SCENE_EVIDENCE_STATUSES = ["AVAILABLE", "STALE", "NOT_INSPECTED"] as const;
export type SceneEvidenceStatus = (typeof SCENE_EVIDENCE_STATUSES)[number];
export const sceneEvidenceStatusSchema = z.enum(SCENE_EVIDENCE_STATUSES);

/**
 * Client-facing UX redesign, "M. VISUAL PREVIEWS ARE MANDATORY" - a real,
 * uploaded per-scene evidence preview frame (scene_evidence_previews'
 * own table doc comment, packages/database/src/schema.ts). Browser-facing
 * DTO carries NO filesystem path - only `filename` (a bare, deterministic,
 * worker-derived basename).
 */
export const sceneEvidencePreviewDtoSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    manifestCompositionId: z.string().min(1),
    sourceProjectSha256: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    byteSize: z.number().int().nonnegative(),
    capturedAt: z.string().datetime(),
    createdAt: z.string().datetime()
  })
  .strict();
export type SceneEvidencePreviewDto = z.infer<typeof sceneEvidencePreviewDtoSchema>;

/** GET .../scenes/:scenePlanId/preview-status - preview metadata, null when no preview has ever been captured for this scene's composition. */
export const sceneEvidencePreviewStatusResponseSchema = z.object({ preview: sceneEvidencePreviewDtoSchema.nullable() }).strict();
export type SceneEvidencePreviewStatusResponse = z.infer<typeof sceneEvidencePreviewStatusResponseSchema>;

/** What POST /api/workers/:workerId/jobs/:jobId/scene-evidence-preview returns on success - mirrors fullPreviewUploadResponseSchema's own contract. */
export const sceneEvidencePreviewUploadResponseSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string()
});
export type SceneEvidencePreviewUploadResponse = z.infer<typeof sceneEvidencePreviewUploadResponseSchema>;

/**
 * The one shared source of truth for this route's path shape - the exact
 * Fastify route pattern apps/api/src/routes/scene-evidence-preview-
 * upload.ts registers (":workerId"/":jobId" are Fastify route params, not
 * real values). Live QA regression, 2026-09-07: this path was previously
 * a literal string independently duplicated in both the Worker's own
 * apps/worker/src/infrastructure/api-client.ts and the API's route
 * registration - they never actually drifted from EACH OTHER, but
 * neither one was ever cross-checked against deploy/nginx/
 * worker-api.dyocourses.com.conf's own separate path allowlist regex,
 * which was simply missing this path entirely, so every real upload
 * silently 404'd at the nginx layer for the whole time this route
 * existed. Both apps now import this ONE constant/function instead of
 * re-typing the path, so a future rename can never make them disagree
 * with each other again - it still cannot, by itself, keep nginx's own
 * separate config in sync, which is exactly why the nginx conf's own
 * comment for this route calls this fact out explicitly.
 */
export const SCENE_EVIDENCE_PREVIEW_UPLOAD_ROUTE = "/api/workers/:workerId/jobs/:jobId/scene-evidence-preview";

/** Builds the real, concrete URL a Worker calls for one specific upload - structurally identical to SCENE_EVIDENCE_PREVIEW_UPLOAD_ROUTE above, only :workerId/:jobId replaced with real values. */
export function sceneEvidencePreviewUploadPath(workerId: string, jobId: string): string {
  return SCENE_EVIDENCE_PREVIEW_UPLOAD_ROUTE.replace(":workerId", workerId).replace(":jobId", jobId);
}
