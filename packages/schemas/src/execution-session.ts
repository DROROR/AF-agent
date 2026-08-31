import { z } from "zod";

/**
 * PROJECT EXECUTION SESSION - the durable entity binding one source .aep +
 * one execution-plan revision + one assigned Worker + one cumulative
 * Worker-local working copy across many sequential scene-edit jobs and,
 * eventually, both output renders (multi-scene-accumulation phase, section
 * 2). Solves the exact gap EXECUTE_FRAME's own job-scoped working copy
 * left open: scene 1's edit and scene 2's edit used to land in two
 * independent copies of the ORIGINAL source, so RENDER could never see
 * both - see resolve-execute-frame-dispatch.ts's own doc comment on the
 * session-aware model this schema now supports.
 *
 * Status is mostly DERIVED from concrete fields (completedScenePlanIds vs.
 * the plan's own required scene set, firstPreviewApproved,
 * latestWorkingProjectSha256) rather than tracked as free-standing state
 * machine transitions - see apps/api/src/domain/execution-session/derive-status.ts.
 * RENDERING/PAUSED are display-time overlays computed at read time (live
 * worker/job state), never persisted - see derive-display-status.ts.
 */
export const EXECUTION_SESSION_STATUSES = [
  "PREPARING",
  "EDITING",
  "AWAITING_PREVIEW_APPROVAL",
  "READY_TO_RENDER",
  "RENDERING",
  "COMPLETED",
  "PAUSED",
  "FAILED"
] as const;
export type ExecutionSessionStatus = (typeof EXECUTION_SESSION_STATUSES)[number];
export const executionSessionStatusSchema = z.enum(EXECUTION_SESSION_STATUSES);

/** Once in one of these, a session accepts no further scene edits or renders - section 11's "start a new execution session" is the only way forward. */
export const TERMINAL_EXECUTION_SESSION_STATUSES: readonly ExecutionSessionStatus[] = ["COMPLETED", "FAILED"];

/**
 * Browser-facing DTO for one execution session - deliberately carries NO
 * filesystem path (the working copy's real location is entirely the
 * Worker's own concern, derived from `id` itself - see
 * apps/worker/src/workspace/working-copy.ts's sessionWorkingCopyPath).
 */
export const executionSessionDtoSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    executionPlanId: z.string().min(1),
    planRevision: z.number().int().positive(),
    sourceProjectSha256: z.string().min(1),
    assignedWorkerId: z.string().uuid(),
    status: executionSessionStatusSchema,
    /** Null until the session's first scene edit has ever succeeded. */
    latestWorkingProjectSha256: z.string().min(1).nullable(),
    /** Every scenePlanId whose EXECUTE_FRAME job has successfully completed against this session's cumulative working copy, in completion order. */
    completedScenePlanIds: z.array(z.string().min(1)),
    firstPreviewApproved: z.boolean(),
    /** True once a real preview PNG has been captured+uploaded for this session - never a filesystem path (see get-preview-file.ts for the actual authenticated download). */
    hasPreview: z.boolean(),
    /** The scenePlanId whose completed edit produced the CURRENT preview - null until hasPreview is true. */
    latestPreviewScenePlanId: z.string().min(1).nullable(),
    latestPreviewCapturedAt: z.string().datetime().nullable(),
    /**
     * Client-handoff phase, "real final preview approval gate" - a
     * SEPARATE approval from firstPreviewApproved above, given only after
     * a human has reviewed the real full_preview_artifacts video (see
     * resolve-render-dispatch.ts's own updated RENDER precondition). Reset
     * to false whenever a NEW full-preview artifact is captured
     * (upload-full-preview.ts) - an old approval never silently carries
     * over to unreviewed content.
     */
    fullPreviewApproved: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();
export type ExecutionSessionDto = z.infer<typeof executionSessionDtoSchema>;

/** Browser picks the worker once, at session-creation time only - every later scene-edit/render dispatch is pinned to session.assignedWorkerId, never re-chosen (section 8: worker affinity). */
export const createExecutionSessionRequestSchema = z.object({ workerId: z.string().uuid() }).strict();
export type CreateExecutionSessionRequest = z.infer<typeof createExecutionSessionRequestSchema>;

export const executionSessionResponseSchema = z.object({ session: executionSessionDtoSchema }).strict();
export type ExecutionSessionResponse = z.infer<typeof executionSessionResponseSchema>;

/** GET .../execution-sessions/current - null when no session has ever been started for this project's current plan. */
export const currentExecutionSessionResponseSchema = z.object({ session: executionSessionDtoSchema.nullable() }).strict();
export type CurrentExecutionSessionResponse = z.infer<typeof currentExecutionSessionResponseSchema>;

/**
 * What POST /api/workers/:workerId/jobs/:jobId/preview returns on success
 * (multi-scene-accumulation phase, section 3: viewable preview) - the
 * worker's own confirmation that its captured preview PNG is now durably
 * stored, byte-verified (sha256/byteSize are server-computed from the
 * actual stored bytes, never echoed from the request). Mirrors
 * renderArtifactUploadResponseSchema's own contract for the opposite
 * (render, not preview) upload.
 */
export const previewUploadResponseSchema = z.object({
  executionSessionId: z.string().uuid(),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string()
});
export type PreviewUploadResponse = z.infer<typeof previewUploadResponseSchema>;
