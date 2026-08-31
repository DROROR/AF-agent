import { randomUUID } from "node:crypto";
import { sceneEvidenceRequestSchema } from "@dyo/schemas";
import { JobConflictError, JobNotFoundError, PayloadTooLargeError, UnauthorizedError, UnsupportedMediaTypeError } from "../../errors/app-error.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";
import type { SceneEvidencePreviewRecord, SceneEvidencePreviewRepository } from "../../domain/scene-evidence-preview/types.js";
import { extensionForMime } from "../../domain/asset/mime-allowlist.js";

export interface UploadSceneEvidencePreviewDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  sceneEvidencePreviewRepository: SceneEvidencePreviewRepository;
  assetStorage: AssetStorage;
  verifyToken: (token: string, storedHash: string) => Promise<boolean>;
  maxUploadBytes: number;
  now: () => Date;
}

export interface UploadSceneEvidencePreviewInput {
  mimeType: string;
  buffer: Buffer;
}

/**
 * Real worker->API scene-evidence preview byte upload (client-facing UX
 * redesign, "M. VISUAL PREVIEWS ARE MANDATORY"). Worker-authenticated,
 * bound to its OWN currently-RUNNING INSPECT_SCENE_EVIDENCE job, project/
 * composition-scoped via that job's own persisted request payload -
 * mirrors upload-full-preview.ts's exact auth/job-ownership/AssetStorage
 * pattern (record directly on upload, no separate staging table).
 *
 * Idempotent by jobId (SceneEvidencePreviewRepository.record()) - a
 * duplicate/retried upload for the same job is a no-op that returns the
 * existing record, never a second row. This is a best-effort, purely
 * additive artifact - INSPECT_SCENE_EVIDENCE's own structural layer facts
 * (scene_evidence) are recorded independently and are never affected by
 * whether this preview upload succeeds or is even attempted (see
 * job-dispatcher.ts's own "a failed/skipped preview never fails the
 * whole evidence result" rule).
 */
export async function uploadSceneEvidencePreview(
  deps: UploadSceneEvidencePreviewDeps,
  workerId: string,
  jobId: string,
  token: string,
  input: UploadSceneEvidencePreviewInput
): Promise<SceneEvidencePreviewRecord> {
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
    throw new JobNotFoundError(jobId);
  }
  if (job.status !== "RUNNING") {
    throw new JobConflictError(`Job ${jobId} is not RUNNING (current status: ${job.status}) - scene-evidence preview uploads are only accepted while a job is running`);
  }
  if (job.operation !== "INSPECT_SCENE_EVIDENCE") {
    throw new JobConflictError(`Job ${jobId}'s operation (${job.operation}) is not INSPECT_SCENE_EVIDENCE - scene-evidence preview uploads only apply to INSPECT_SCENE_EVIDENCE jobs`);
  }
  if (!job.projectId) {
    throw new JobConflictError(`Job ${jobId} has no projectId - cannot attribute an uploaded scene preview to any project`);
  }

  const parsedPayload = sceneEvidenceRequestSchema.safeParse(job.payload);
  if (!parsedPayload.success) {
    throw new JobConflictError(`Job ${jobId}'s own INSPECT_SCENE_EVIDENCE request payload could not be read - cannot attribute this preview to any scene`);
  }
  const { manifestCompositionId, sourceProjectSha256, compositionName } = parsedPayload.data;

  if (input.buffer.length > deps.maxUploadBytes) {
    throw new PayloadTooLargeError(deps.maxUploadBytes);
  }
  const extension = extensionForMime(input.mimeType);
  if (!extension) {
    throw new UnsupportedMediaTypeError(`Unsupported file type: ${input.mimeType}`);
  }

  const stored = await deps.assetStorage.store({ projectId: job.projectId, buffer: input.buffer, extension });

  try {
    const recorded = await deps.sceneEvidencePreviewRepository.record(
      {
        id: randomUUID(),
        projectId: job.projectId,
        jobId,
        manifestCompositionId,
        sourceProjectSha256,
        filename: `scene-preview-${compositionName.replace(/[^a-zA-Z0-9._-]+/g, "_")}.${extension}`,
        mimeType: input.mimeType,
        byteSize: stored.byteSize,
        storageKey: stored.storageKey,
        sha256: stored.sha256,
        capturedAt: deps.now()
      },
      deps.now()
    );
    if (recorded.storageKey !== stored.storageKey) {
      await deps.assetStorage.delete(stored.storageKey);
    }
    return recorded;
  } catch (error) {
    await deps.assetStorage.delete(stored.storageKey);
    throw error;
  }
}
