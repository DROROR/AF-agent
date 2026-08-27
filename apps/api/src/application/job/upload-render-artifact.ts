import { randomUUID } from "node:crypto";
import { renderProjectRequestSchema, type RenderOutputVariant } from "@dyo/schemas";
import { JobConflictError, JobNotFoundError, UnauthorizedError, UnsupportedMediaTypeError, PayloadTooLargeError } from "../../errors/app-error.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";
import type { RenderArtifactUploadRecord, RenderArtifactUploadRepository } from "../../domain/render-artifact-upload/types.js";
import { extensionForMime } from "../../domain/asset/mime-allowlist.js";

export interface UploadRenderArtifactDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  renderArtifactUploadRepository: RenderArtifactUploadRepository;
  assetStorage: AssetStorage;
  verifyToken: (token: string, storedHash: string) => Promise<boolean>;
  maxUploadBytes: number;
  now: () => Date;
}

export interface UploadRenderArtifactInput {
  variant: RenderOutputVariant;
  mimeType: string;
  buffer: Buffer;
}

/**
 * Real render-artifact byte upload (render-delivery phase section 4) -
 * worker-authenticated, bound to its OWN currently-RUNNING RENDER job,
 * project-scoped via that job. The worker sends bytes; it never tells this
 * function where on the server's filesystem to write them (see
 * AssetStorage.store - a fresh server-generated name every time, never a
 * caller-supplied path). sha256/byteSize are always computed by
 * AssetStorage from the actual written bytes, never trusted from the
 * worker's own claim.
 *
 * Idempotent/retry-safe (section 4): a duplicate upload for the same job
 * whose bytes hash identically to an already-recorded upload is a no-op
 * (the just-written duplicate storage object is deleted, never orphaned).
 * A re-upload with DIFFERENT bytes (a genuine second render attempt for
 * the same job, e.g. after a checkpoint-resumed re-render) REPLACES the
 * prior upload record and deletes the prior storage object - a job can
 * only ever have one current uploaded artifact, never two silently
 * accumulating.
 */
export async function uploadRenderArtifact(
  deps: UploadRenderArtifactDeps,
  workerId: string,
  jobId: string,
  token: string,
  input: UploadRenderArtifactInput
): Promise<RenderArtifactUploadRecord> {
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
    // reportJobStatus/reportJobCheckpoint.
    throw new JobNotFoundError(jobId);
  }
  if (job.status !== "RUNNING") {
    throw new JobConflictError(`Job ${jobId} is not RUNNING (current status: ${job.status}) - artifact uploads are only accepted while a job is running`);
  }
  if (job.operation !== "RENDER") {
    throw new JobConflictError(`Job ${jobId}'s operation (${job.operation}) is not RENDER - artifact uploads only apply to RENDER jobs`);
  }
  if (!job.projectId) {
    throw new JobConflictError(`Job ${jobId} has no projectId - cannot attribute an uploaded artifact to any project`);
  }

  // Defense in depth: the claimed variant must match this job's OWN
  // persisted RENDER request - a worker can never upload bytes under a
  // variant unrelated to what this job was actually dispatched to render.
  const parsedPayload = renderProjectRequestSchema.safeParse(job.payload);
  if (parsedPayload.success && parsedPayload.data.variant !== input.variant) {
    throw new JobConflictError(`Uploaded variant (${input.variant}) does not match this job's own RENDER request variant (${parsedPayload.data.variant})`);
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
    const existing = await deps.renderArtifactUploadRepository.findByJobId(jobId);
    if (existing) {
      if (existing.sha256 === stored.sha256) {
        // Harmless duplicate/retry - the just-written object is redundant.
        await deps.assetStorage.delete(stored.storageKey);
        return existing;
      }
      const replaced = await deps.renderArtifactUploadRepository.replace(
        existing.id,
        {
          id: existing.id,
          projectId: job.projectId,
          jobId,
          variant: input.variant,
          storageKey: stored.storageKey,
          sha256: stored.sha256,
          byteSize: stored.byteSize,
          mimeType: input.mimeType
        },
        deps.now()
      );
      // Only delete the OLD object after the new row is durably in place,
      // never before - a failure between these two steps must never leave
      // this job with zero valid uploaded bytes on record.
      await deps.assetStorage.delete(existing.storageKey);
      return replaced;
    }

    return await deps.renderArtifactUploadRepository.insert(
      {
        id: randomUUID(),
        projectId: job.projectId,
        jobId,
        variant: input.variant,
        storageKey: stored.storageKey,
        sha256: stored.sha256,
        byteSize: stored.byteSize,
        mimeType: input.mimeType
      },
      deps.now()
    );
  } catch (error) {
    // The metadata write failed for some reason - never leave an orphaned
    // file behind (same "clean up partial state" contract as upload-asset.ts).
    await deps.assetStorage.delete(stored.storageKey);
    throw error;
  }
}
