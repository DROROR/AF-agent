import { z } from "zod";
import { sceneEditCheckpointSchema, type SceneEditCheckpoint } from "./execute-scene-edit.js";

/**
 * CORE RENDER ENGINE (worker capability "RENDER" - already allowlisted in
 * WORKER_CAPABILITIES, worker.ts). Renders the approved, already-EDITED
 * working copy (never the original .aep - CLAUDE.md Safety Rule 1) via the
 * real `aerender` CLI (CLAUDE.md: "Final render: aerender.exe, separate
 * from editing operations"). Strict output variants only - never an
 * arbitrary renderer command (section 2 of the render-engine phase).
 */
export const RENDER_OUTPUT_VARIANTS = ["LANDSCAPE", "REELS"] as const;
export type RenderOutputVariant = (typeof RENDER_OUTPUT_VARIANTS)[number];
export const renderOutputVariantSchema = z.enum(RENDER_OUTPUT_VARIANTS);

/**
 * A fixed, 4-stage pipeline - never a free-form stage name. Reuses
 * EXECUTE_FRAME's own `sceneEditCheckpointSchema`/`SceneEditCheckpoint`
 * shape and algebra (`completedOperationIndices`/`checkpointBeforeAt`/
 * `checkpointAfterAt`/`failureReason` - see scene-edit-checkpoint.ts on
 * both apps/api and apps/worker) rather than inventing a parallel,
 * structurally-identical type: here `completedOperationIndices` means
 * "which of these 4 fixed stages (by index) have completed", not "which
 * SceneEditOperation index" - the shape and monotonicity rule are
 * identical, only the semantic label differs, so
 * report-job-checkpoint.ts's durable checkpoint endpoint is reused
 * unchanged for RENDER jobs too (see that file's operation allowlist).
 */
export const RENDER_STAGES = [
  "VERIFY_WORKING_COPY",
  "VERIFY_COMPOSITION",
  "RUN_AERENDER",
  "VALIDATE_ARTIFACT"
] as const;
export type RenderStage = (typeof RENDER_STAGES)[number];

export const renderCheckpointSchema = sceneEditCheckpointSchema;
export type RenderCheckpoint = SceneEditCheckpoint;

/**
 * The full RENDER request - derived from an approved execution plan +
 * an already-produced, already-verified working copy (the output of one
 * or more prior EXECUTE_FRAME jobs). `workingProjectPath` is NOT derived
 * from this job's own jobId (unlike EXECUTE_FRAME) - a render job
 * continues from a working copy an EARLIER job already created/edited, so
 * this field is asserted directly and re-verified (existence, hash, and
 * that it stays strictly inside the worker's configured work root) by the
 * worker itself before ever touching it - see
 * render-project-executor.ts/assert-path-within-root.ts. `aeProjectItemIndex`/
 * `compositionName` use the exact same canonical-composition-addressing
 * pairing established for EXECUTE_FRAME/INSPECT_SCENE_EVIDENCE (never an
 * ambiguous bare index - see execute-scene-edit.ts's own doc comment).
 *
 * `renderSettingsTemplateName`/`outputModuleTemplateName` are explicit,
 * human-reviewed AE Render Queue template NAMES (aerender's own
 * `-RStemplate`/`-OMtemplate` flags) - never a free-form shell fragment,
 * never a codec/container guess baked into this contract. Which named
 * template actually emits H.264/MP4 on the real client AE 2026 install is
 * NOT assumed here; that is a real, human-verified value supplied by
 * whatever creates this request (see the render-engine phase's own
 * OUTPUT_MODULE_STRATEGY note - unresolved without real client-machine
 * verification).
 */
export const renderProjectRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    planId: z.string().min(1),
    planRevision: z.number().int().positive(),
    variant: renderOutputVariantSchema,
    sourceProjectPath: z.string().min(1),
    sourceProjectSha256: z.string().min(1),
    workingProjectPath: z.string().min(1),
    /** Re-verified from the real file on disk before rendering - never merely trusted from the request (section 5: "working-copy SHA matches expected"). */
    workingProjectSha256: z.string().min(1),
    aeProjectItemIndex: z.number().int().positive(),
    compositionName: z.string().min(1),
    renderSettingsTemplateName: z.string().min(1),
    outputModuleTemplateName: z.string().min(1),
    checkpoint: renderCheckpointSchema.nullable()
  })
  .strict()
  .refine((data) => data.workingProjectPath !== data.sourceProjectPath, {
    message: "workingProjectPath must differ from sourceProjectPath - the original .aep is never a render target",
    path: ["workingProjectPath"]
  });
export type RenderProjectRequest = z.infer<typeof renderProjectRequestSchema>;

export const RENDER_ARTIFACT_VALIDATION_STATUSES = ["VALID", "INVALID"] as const;
export type RenderArtifactValidationStatus = (typeof RENDER_ARTIFACT_VALIDATION_STATUSES)[number];
export const renderArtifactValidationStatusSchema = z.enum(RENDER_ARTIFACT_VALIDATION_STATUSES);

/**
 * Strict render artifact metadata (section 11) - deliberately carries NO
 * absolute filesystem path (worker-local paths never cross the worker/API
 * boundary as a trusted value - see docs/engineering/SECURITY.md). Only
 * `filename` (a bare, deterministic, worker-derived basename) is exposed;
 * the API's own persistence layer assigns a separate, opaque
 * `artifactId`/storage identity on top of this (see
 * apps/api/src/domain/render-artifact/types.ts) - this schema is the
 * worker's own job-result contract, not the API's storage record.
 */
export const renderArtifactSchema = z
  .object({
    variant: renderOutputVariantSchema,
    workingProjectSha256: z.string().min(1),
    compositionName: z.string().min(1),
    /** Bare basename only, e.g. "output.mp4" - never a path. */
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    byteSize: z.number().int().nonnegative(),
    renderStartedAt: z.string().datetime(),
    renderCompletedAt: z.string().datetime(),
    aerenderExitCode: z.number().int(),
    /** A bounded excerpt of aerender's own stdout/stderr, safe for troubleshooting - never the worker's credentials/env (section 16). Null if no log was captured. */
    logExcerpt: z.string().nullable(),
    validationStatus: renderArtifactValidationStatusSchema,
    validationFailureReason: z.string().nullable()
  })
  .strict();
export type RenderArtifact = z.infer<typeof renderArtifactSchema>;

/**
 * What a real worker RENDER execution reports back - metadata alone is
 * never "success"; `artifact` is null until VALIDATE_ARTIFACT (the final
 * stage) genuinely completes with validationStatus "VALID". Mirrors
 * sceneEditResultSchema's own jobId/workerId stamping convention (absent
 * until job-dispatcher.ts stamps them - the executor itself is never
 * handed job/worker identity).
 */
export const renderProjectResultSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    workerId: z.string().min(1).optional(),
    variant: renderOutputVariantSchema,
    workingProjectSha256: z.string().min(1),
    artifact: renderArtifactSchema.nullable(),
    checkpoint: renderCheckpointSchema,
    failureReason: z.string().nullable(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime()
  })
  .strict();
export type RenderProjectResult = z.infer<typeof renderProjectResultSchema>;

/**
 * Browser-facing DTO for one persisted render artifact record (render-
 * engine phase section 11/12) - deliberately carries NO filesystem path
 * (see render_artifacts' own table doc comment, packages/database/src/schema.ts).
 * `id` here is the API's own server-generated storage identity, distinct
 * from `jobId` (which job produced it).
 */
export const renderArtifactDtoSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    jobId: z.string().uuid(),
    variant: renderOutputVariantSchema,
    compositionName: z.string(),
    workingProjectSha256: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    byteSize: z.number().int().nonnegative(),
    /** Server-computed integrity hash of the real stored bytes - safe to expose (unlike storageKey, which is never included here). */
    sha256: z.string(),
    renderStartedAt: z.string().datetime(),
    renderCompletedAt: z.string().datetime(),
    aerenderExitCode: z.number().int(),
    validationStatus: renderArtifactValidationStatusSchema,
    createdAt: z.string().datetime()
  })
  .strict();
export type RenderArtifactDto = z.infer<typeof renderArtifactDtoSchema>;

export const listRenderArtifactsResponseSchema = z.object({
  artifacts: z.array(renderArtifactDtoSchema)
});
export type ListRenderArtifactsResponse = z.infer<typeof listRenderArtifactsResponseSchema>;

/**
 * What POST /api/workers/:workerId/jobs/:jobId/artifact returns on success
 * (render-delivery phase section 4) - the worker's own confirmation that
 * its render bytes are now durably stored, byte-verified (sha256/byteSize
 * are server-computed from the real stored bytes, never echoed from the
 * request).
 */
export const renderArtifactUploadResponseSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  variant: renderOutputVariantSchema,
  byteSize: z.number().int().nonnegative(),
  sha256: z.string()
});
export type RenderArtifactUploadResponse = z.infer<typeof renderArtifactUploadResponseSchema>;
