import { JobConflictError, JobNotFoundError, UnauthorizedError } from "../../errors/app-error.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";
import { findOwnedAsset } from "./find-owned-asset.js";
import type { AssetRepository } from "../../domain/asset/types.js";

export interface GetAssetFileForWorkerDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  assetRepository: AssetRepository;
  assetStorage: AssetStorage;
  verifyToken: (token: string, storedHash: string) => Promise<boolean>;
}

export interface AssetFileForWorker {
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
}

/**
 * MAP_FOOTAGE's asset-delivery pipeline (activation-phase Gap 2) -
 * worker-authenticated, bound to its OWN currently-RUNNING EXECUTE_FRAME
 * job, project-scoped via that job - the exact same worker-auth/job-
 * ownership shape upload-render-artifact.ts already established for the
 * reverse (worker -> API) transfer direction. The worker never learns a
 * storage path/key - only real bytes plus the asset's own real mimeType/
 * filename (mirrors get-asset-file.ts's own browser-facing contract).
 *
 * Cross-project access is refused the same way findOwnedAsset already
 * refuses it for the browser-facing route: an asset that exists but
 * belongs to a different project than this job's own projectId is
 * treated identically to one that doesn't exist at all.
 */
export async function getAssetFileForWorker(
  deps: GetAssetFileForWorkerDeps,
  workerId: string,
  jobId: string,
  token: string,
  assetId: string
): Promise<AssetFileForWorker> {
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
    throw new JobConflictError(`Job ${jobId} is not RUNNING (current status: ${job.status}) - asset downloads are only accepted while a job is running`);
  }
  if (job.operation !== "EXECUTE_FRAME") {
    throw new JobConflictError(`Job ${jobId}'s operation (${job.operation}) is not EXECUTE_FRAME - asset downloads only apply to EXECUTE_FRAME jobs`);
  }
  if (!job.projectId) {
    throw new JobConflictError(`Job ${jobId} has no projectId - cannot verify asset ownership`);
  }

  const asset = await findOwnedAsset(deps.assetRepository, job.projectId, assetId);
  const buffer = await deps.assetStorage.read(asset.storageKey);
  return { buffer, mimeType: asset.mimeType, originalFilename: asset.originalFilename };
}
