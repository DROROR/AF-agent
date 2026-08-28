import { executeSceneEditRequestSchema } from "@dyo/schemas";
import { JobConflictError, JobNotFoundError, PayloadTooLargeError, UnauthorizedError, UnsupportedMediaTypeError } from "../../errors/app-error.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";

export interface UploadPreviewDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  executionSessionRepository: ExecutionSessionRepository;
  assetStorage: AssetStorage;
  verifyToken: (token: string, storedHash: string) => Promise<boolean>;
  maxUploadBytes: number;
  now: () => Date;
}

export interface UploadPreviewInput {
  mimeType: string;
  buffer: Buffer;
}

export interface UploadPreviewResult {
  executionSessionId: string;
  byteSize: number;
  sha256: string;
}

const PREVIEW_MIME_TYPE = "image/png";
const PREVIEW_EXTENSION = "png";

/**
 * Real worker->API preview byte upload (multi-scene-accumulation phase,
 * section 3: "Worker preview PNG -> authenticated upload -> persisted
 * preview metadata"). Worker-authenticated, bound to its OWN currently-
 * RUNNING EXECUTE_FRAME job, session-scoped via that job's own persisted
 * request payload - the worker never tells this function which session
 * the preview belongs to directly (defense in depth: it can only ever
 * upload against the session its own currently-running job was actually
 * dispatched for). Mirrors upload-render-artifact.ts's exact auth/
 * job-ownership/AssetStorage pattern.
 *
 * A session has exactly ONE current preview (schema.ts's own doc comment
 * on the four latestPreview* columns) - a repeat capture (e.g. a
 * checkpoint-resumed EXECUTE_FRAME re-attempt) REPLACES it; the prior
 * stored object is deleted only AFTER the new record is durably in place,
 * never before (same ordering upload-render-artifact.ts already
 * established for its own replace path).
 */
export async function uploadPreview(
  deps: UploadPreviewDeps,
  workerId: string,
  jobId: string,
  token: string,
  input: UploadPreviewInput
): Promise<UploadPreviewResult> {
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
    // reportJobStatus/reportJobCheckpoint/uploadRenderArtifact.
    throw new JobNotFoundError(jobId);
  }
  if (job.status !== "RUNNING") {
    throw new JobConflictError(`Job ${jobId} is not RUNNING (current status: ${job.status}) - preview uploads are only accepted while a job is running`);
  }
  if (job.operation !== "EXECUTE_FRAME") {
    throw new JobConflictError(`Job ${jobId}'s operation (${job.operation}) is not EXECUTE_FRAME - preview uploads only apply to EXECUTE_FRAME jobs`);
  }

  const parsedPayload = executeSceneEditRequestSchema.safeParse(job.payload);
  if (!parsedPayload.success) {
    throw new JobConflictError(`Job ${jobId}'s own EXECUTE_FRAME request payload could not be read - cannot attribute this preview to any execution session`);
  }
  const { executionSessionId, scenePlanId } = parsedPayload.data;

  const session = await deps.executionSessionRepository.findById(executionSessionId);
  if (!session || session.assignedWorkerId !== workerId) {
    throw new JobConflictError(`Execution session ${executionSessionId} is not assigned to this worker - cannot attribute this preview to it`);
  }

  if (input.mimeType !== PREVIEW_MIME_TYPE) {
    throw new UnsupportedMediaTypeError(`Preview uploads must be ${PREVIEW_MIME_TYPE}, got: ${input.mimeType}`);
  }
  if (input.buffer.length > deps.maxUploadBytes) {
    throw new PayloadTooLargeError(deps.maxUploadBytes);
  }

  const stored = await deps.assetStorage.store({ projectId: session.projectId, buffer: input.buffer, extension: PREVIEW_EXTENSION });

  try {
    const recorded = await deps.executionSessionRepository.recordPreview(
      session.id,
      { storageKey: stored.storageKey, sha256: stored.sha256, scenePlanId, capturedAt: deps.now() },
      deps.now()
    );
    if (!recorded) {
      throw new JobConflictError(`Execution session ${executionSessionId} no longer exists`);
    }
    // Only delete the OLD object after the new row is durably in place,
    // never before - a failure between these two steps must never leave
    // this session with zero valid preview bytes on record.
    if (recorded.priorStorageKey && recorded.priorStorageKey !== stored.storageKey) {
      await deps.assetStorage.delete(recorded.priorStorageKey);
    }
    return { executionSessionId: session.id, byteSize: stored.byteSize, sha256: stored.sha256 };
  } catch (error) {
    // The metadata write failed for some reason - never leave an orphaned
    // file behind (same "clean up partial state" contract as upload-asset.ts/upload-render-artifact.ts).
    await deps.assetStorage.delete(stored.storageKey);
    throw error;
  }
}
