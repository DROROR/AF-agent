import { randomUUID } from "node:crypto";
import { createFullPreviewRequestSchema } from "@dyo/schemas";
import { JobConflictError, JobNotFoundError, PayloadTooLargeError, UnauthorizedError, UnsupportedMediaTypeError } from "../../errors/app-error.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import type { FullPreviewArtifactRecord, FullPreviewArtifactRepository } from "../../domain/full-preview-artifact/types.js";
import { extensionForMime } from "../../domain/asset/mime-allowlist.js";

export interface UploadFullPreviewDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  executionSessionRepository: ExecutionSessionRepository;
  fullPreviewArtifactRepository: FullPreviewArtifactRepository;
  assetStorage: AssetStorage;
  verifyToken: (token: string, storedHash: string) => Promise<boolean>;
  maxUploadBytes: number;
  now: () => Date;
}

export interface UploadFullPreviewInput {
  mimeType: string;
  buffer: Buffer;
}

/**
 * Real worker->API full-preview byte upload (client-handoff phase, "real
 * final preview approval gate", section 2). Worker-authenticated, bound
 * to its OWN currently-RUNNING CREATE_PREVIEW job, project/session-scoped
 * via that job's own persisted request payload - mirrors upload-preview.ts's
 * exact auth/job-ownership/AssetStorage pattern (record directly on
 * upload, no separate staging table - see full_preview_artifacts' own
 * table doc comment for why this differs from render_artifacts' two-phase
 * pattern).
 *
 * Idempotent by jobId (FullPreviewArtifactRepository.record()) - a
 * duplicate/retried upload for the same job is a no-op that returns the
 * existing record, never a second row.
 *
 * Whenever a genuinely NEW full-preview artifact is recorded, this ALSO
 * resets the session's own fullPreviewApproved back to false - an old
 * approval must never silently carry over to unreviewed content (see
 * execution_sessions.fullPreviewApproved's own doc comment).
 */
export async function uploadFullPreview(
  deps: UploadFullPreviewDeps,
  workerId: string,
  jobId: string,
  token: string,
  input: UploadFullPreviewInput
): Promise<FullPreviewArtifactRecord> {
  const worker = await deps.workerRepository.findById(workerId);
  if (!worker) {
    throw new UnauthorizedError("Invalid worker credentials");
  }
  const validToken = await deps.verifyToken(token, worker.tokenHash);
  if (!validToken) {
    throw new UnauthorizedError("Invalid worker credentials");
  }

  const job = await deps.jobRepository.findById(jobId);
  if (!job || job.workerId !== workerId) {
    // Same "not found vs not yours" non-distinguishable shape as
    // reportJobStatus/uploadPreview/uploadRenderArtifact.
    throw new JobNotFoundError(jobId);
  }
  if (job.status !== "RUNNING") {
    throw new JobConflictError(`Job ${jobId} is not RUNNING (current status: ${job.status}) - complete-preview uploads are only accepted while a job is running`);
  }
  if (job.operation !== "CREATE_PREVIEW") {
    throw new JobConflictError(`Job ${jobId}'s operation (${job.operation}) is not CREATE_PREVIEW - complete-preview uploads only apply to CREATE_PREVIEW jobs`);
  }
  if (!job.projectId) {
    throw new JobConflictError(`Job ${jobId} has no projectId - cannot attribute an uploaded complete preview to any project`);
  }

  const parsedPayload = createFullPreviewRequestSchema.safeParse(job.payload);
  if (!parsedPayload.success) {
    throw new JobConflictError(`Job ${jobId}'s own CREATE_PREVIEW request payload could not be read - cannot attribute this complete preview to any execution session`);
  }
  const { executionSessionId, expectedWorkingProjectSha256, compositionName } = parsedPayload.data;

  const session = await deps.executionSessionRepository.findById(executionSessionId);
  if (!session || session.assignedWorkerId !== workerId) {
    throw new JobConflictError(`Execution session ${executionSessionId} is not assigned to this worker - cannot attribute this complete preview to it`);
  }

  if (input.buffer.length > deps.maxUploadBytes) {
    throw new PayloadTooLargeError(deps.maxUploadBytes);
  }
  const extension = extensionForMime(input.mimeType);
  if (!extension) {
    throw new UnsupportedMediaTypeError(`Unsupported file type: ${input.mimeType}`);
  }

  const stored = await deps.assetStorage.store({ projectId: job.projectId, buffer: input.buffer, extension });

  try {
    const recorded = await deps.fullPreviewArtifactRepository.record(
      {
        id: randomUUID(),
        projectId: job.projectId,
        executionSessionId,
        jobId,
        workingProjectSha256: expectedWorkingProjectSha256,
        filename: `preview-${compositionName.replace(/[^a-zA-Z0-9._-]+/g, "_")}.${extension}`,
        mimeType: input.mimeType,
        byteSize: stored.byteSize,
        storageKey: stored.storageKey,
        sha256: stored.sha256,
        capturedAt: deps.now()
      },
      deps.now()
    );
    // A duplicate/retried upload for the same job returns the EXISTING
    // record unchanged (record() is idempotent by jobId) - the just-
    // written duplicate storage object is then redundant, never orphaned.
    if (recorded.storageKey !== stored.storageKey) {
      await deps.assetStorage.delete(stored.storageKey);
    } else {
      // A genuinely new artifact - any prior approval was for different,
      // now-superseded content and must never silently carry over.
      await deps.executionSessionRepository.setFullPreviewApproved(session.id, false, deps.now());
    }
    return recorded;
  } catch (error) {
    // The metadata write failed for some reason - never leave an orphaned
    // file behind (same "clean up partial state" contract as upload-asset.ts/upload-render-artifact.ts).
    await deps.assetStorage.delete(stored.storageKey);
    throw error;
  }
}
