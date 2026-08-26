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
    /** AE's own composition index, as recorded in the manifest this scene came from - never guessed from the composition's display name. */
    compositionIndex: z.number().int().nonnegative(),
    layerIndices: z.array(z.number().int().positive()).min(1).max(MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST),
    /** When set, captures exactly one read-only preview frame at this timestamp via ae_capture_frame. Optional: evidence can be gathered without a preview. */
    previewTimestampSeconds: z.number().nonnegative().nullable().default(null)
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
    compositionIndex: z.number().int().nonnegative(),
    compositionName: z.string(),
    layers: z.array(layerEvidenceSchema),
    /** Null whenever previewTimestampSeconds was not requested, or the capture attempt failed - a failed preview never fails the whole evidence result (layer facts are still useful on their own). */
    preview: scenePreviewSchema.nullable(),
    /** Present only when a preview was requested but could not be captured - kept distinct from `preview: null` meaning "not requested". */
    previewFailureReason: z.string().nullable(),
    capturedAt: z.string().datetime()
  })
  .strict();
export type SceneEvidenceResponse = z.infer<typeof sceneEvidenceResponseSchema>;
