import { z } from "zod";

/**
 * FULL PREVIEW (client-handoff phase, "real final preview approval
 * gate") - worker capability "CREATE_PREVIEW", already allowlisted in
 * WORKER_CAPABILITIES (worker.ts) as reserved/planned. Produces a real,
 * assembled video of the session's CURRENT cumulative working copy - a
 * distinct artifact TYPE from both the mid-execution first-preview PNG
 * (execution_sessions.latestPreview*) and a final Landscape/Reels
 * delivery (render_artifacts) - see full_preview_artifacts' own table
 * doc comment.
 *
 * Deliberately single-shot (no checkpoint/resume field, unlike
 * EXECUTE_FRAME/RENDER): a full preview is a quick, low-stakes review
 * artifact, not a mission-critical final deliverable, so a failed attempt
 * simply gets re-dispatched from scratch rather than needing true
 * partial-progress resume.
 *
 * Reuses the project's already-configured LANDSCAPE render output
 * (RenderOutputConfig - see set-render-output-config.ts) for its own
 * composition/template identity, rather than inventing a second,
 * competing "preview composition" concept - see
 * resolve-create-full-preview-dispatch.ts's own doc comment.
 */
export const createFullPreviewRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    executionSessionId: z.string().uuid(),
    sourceProjectPath: z.string().min(1),
    /** The original .aep's expected hash - re-verified BEFORE and AFTER creating the preview (CLAUDE.md Safety Rule 1/8), same "original .aep must remain byte-for-byte unchanged" contract as RENDER's own sourceProjectSha256. */
    sourceProjectSha256: z.string().min(1),
    /** Re-verified from the real file on disk before rendering - never merely trusted from the request (same "VERIFY_WORKING_COPY" contract as RENDER). */
    expectedWorkingProjectSha256: z.string().min(1),
    aeProjectItemIndex: z.number().int().positive(),
    compositionName: z.string().min(1),
    renderSettingsTemplateName: z.string().min(1),
    outputModuleTemplateName: z.string().min(1)
  })
  .strict();
export type CreateFullPreviewRequest = z.infer<typeof createFullPreviewRequestSchema>;

/**
 * Strict full-preview artifact metadata - deliberately carries NO
 * absolute filesystem path (same "worker-local paths never cross the
 * worker/API boundary" rule as renderArtifactSchema). Only `filename` (a
 * bare, deterministic, worker-derived basename) is exposed.
 */
export const fullPreviewArtifactSchema = z
  .object({
    workingProjectSha256: z.string().min(1),
    compositionName: z.string().min(1),
    /** Bare basename only, e.g. "preview.mp4" - never a path. */
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    byteSize: z.number().int().nonnegative(),
    capturedAt: z.string().datetime()
  })
  .strict();
export type FullPreviewArtifact = z.infer<typeof fullPreviewArtifactSchema>;

/**
 * What a real worker CREATE_PREVIEW execution reports back - metadata
 * alone is never "success"; the real bytes are uploaded separately (see
 * upload-full-preview.ts) BEFORE this job's own SUCCEEDED report, same
 * upload-before-report ordering RENDER already establishes.
 */
export const createFullPreviewResultSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    workerId: z.string().min(1).optional(),
    executionSessionId: z.string().uuid(),
    workingProjectSha256: z.string().min(1),
    artifact: fullPreviewArtifactSchema.nullable(),
    failureReason: z.string().nullable(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime()
  })
  .strict();
export type CreateFullPreviewResult = z.infer<typeof createFullPreviewResultSchema>;

/**
 * Browser-facing DTO for one persisted full-preview artifact record -
 * carries NO filesystem path (see full_preview_artifacts' own table doc
 * comment). `id` here is the API's own server-generated storage identity,
 * distinct from `jobId`.
 */
export const fullPreviewArtifactDtoSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    executionSessionId: z.string().uuid(),
    workingProjectSha256: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    byteSize: z.number().int().nonnegative(),
    capturedAt: z.string().datetime(),
    createdAt: z.string().datetime()
  })
  .strict();
export type FullPreviewArtifactDto = z.infer<typeof fullPreviewArtifactDtoSchema>;

/** GET .../execution-sessions/:sessionId/full-preview - artifact metadata, null when no full preview has ever been captured for the CURRENT working copy sha yet. */
export const fullPreviewArtifactResponseSchema = z.object({ artifact: fullPreviewArtifactDtoSchema.nullable() }).strict();
export type FullPreviewArtifactResponse = z.infer<typeof fullPreviewArtifactResponseSchema>;

/** What POST /api/workers/:workerId/jobs/:jobId/full-preview returns on success - mirrors renderArtifactUploadResponseSchema's own contract for the opposite (render, not full-preview) upload. */
export const fullPreviewUploadResponseSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string()
});
export type FullPreviewUploadResponse = z.infer<typeof fullPreviewUploadResponseSchema>;
