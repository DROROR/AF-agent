import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { JobConflictError, JobNotFoundError, UnauthorizedError } from "../../../errors/app-error.js";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemorySceneEvidencePreviewRepository } from "../../../domain/scene-evidence-preview/test-support/in-memory-scene-evidence-preview-repository.js";
import { InMemoryAssetStorage } from "../../asset/test-support/in-memory-asset-storage.js";
import { uploadSceneEvidencePreview } from "../upload-scene-evidence-preview.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const WORKER_TOKEN = "real-worker-token";
const SHA = "a".repeat(64);

async function verifyToken(token: string, storedHash: string): Promise<boolean> {
  return token === storedHash;
}

function sceneEvidencePayload() {
  return {
    sourceProjectPath: "C:\\vidio agent\\White App Promo.aep",
    sourceProjectSha256: SHA,
    manifestCompositionId: "comp-1",
    aeProjectItemIndex: 5,
    compositionName: "Scene 01",
    layerIndices: [1, 3],
    previewTimestampSeconds: 0
  };
}

async function setup() {
  const jobRepository = new InMemoryJobRepository();
  const workerRepository = new InMemoryWorkerRepository();
  const sceneEvidencePreviewRepository = new InMemorySceneEvidencePreviewRepository();
  const assetStorage = new InMemoryAssetStorage();
  const workerId = randomUUID();
  await workerRepository.create({ id: workerId, name: "Worker", tokenHash: WORKER_TOKEN, maxConcurrency: 1, capabilities: ["INSPECT_SCENE_EVIDENCE"] }, NOW);
  const job = await jobRepository.create(
    { id: randomUUID(), workerId, projectId: PROJECT_ID, operation: "INSPECT_SCENE_EVIDENCE", payload: sceneEvidencePayload() },
    NOW
  );
  await jobRepository.updateStatus(job.id, workerId, { expectedCurrentStatus: "QUEUED", status: "CLAIMED" }, NOW);
  await jobRepository.updateStatus(job.id, workerId, { expectedCurrentStatus: "CLAIMED", status: "RUNNING" }, NOW);
  const deps = {
    jobRepository,
    workerRepository,
    sceneEvidencePreviewRepository,
    assetStorage,
    verifyToken,
    maxUploadBytes: 10_000_000,
    now: () => NOW
  };
  return { deps, workerId, jobId: job.id, sceneEvidencePreviewRepository, assetStorage };
}

describe("uploadSceneEvidencePreview", () => {
  it("throws UnauthorizedError for a wrong token", async () => {
    const { deps, workerId, jobId } = await setup();
    await expect(uploadSceneEvidencePreview(deps, workerId, jobId, "wrong-token", { mimeType: "image/png", buffer: Buffer.from("x") })).rejects.toThrow(UnauthorizedError);
  });

  it("throws JobNotFoundError for a job belonging to a different worker", async () => {
    const { deps, jobId } = await setup();
    const otherWorkerId = randomUUID();
    await deps.workerRepository.create({ id: otherWorkerId, name: "Other Worker", tokenHash: WORKER_TOKEN, maxConcurrency: 1, capabilities: ["INSPECT_SCENE_EVIDENCE"] }, NOW);
    await expect(uploadSceneEvidencePreview(deps, otherWorkerId, jobId, WORKER_TOKEN, { mimeType: "image/png", buffer: Buffer.from("x") })).rejects.toThrow(JobNotFoundError);
  });

  it("refuses when the job's operation is not INSPECT_SCENE_EVIDENCE", async () => {
    const { deps, workerId } = await setup();
    const otherJob = await deps.jobRepository.create({ id: randomUUID(), workerId, projectId: PROJECT_ID, operation: "RENDER", payload: {} }, NOW);
    await deps.jobRepository.updateStatus(otherJob.id, workerId, { expectedCurrentStatus: "QUEUED", status: "CLAIMED" }, NOW);
    await deps.jobRepository.updateStatus(otherJob.id, workerId, { expectedCurrentStatus: "CLAIMED", status: "RUNNING" }, NOW);
    await expect(uploadSceneEvidencePreview(deps, workerId, otherJob.id, WORKER_TOKEN, { mimeType: "image/png", buffer: Buffer.from("x") })).rejects.toThrow(JobConflictError);
  });

  it("refuses when the job is not RUNNING", async () => {
    const jobRepository = new InMemoryJobRepository();
    const workerRepository = new InMemoryWorkerRepository();
    const sceneEvidencePreviewRepository = new InMemorySceneEvidencePreviewRepository();
    const assetStorage = new InMemoryAssetStorage();
    const workerId = randomUUID();
    await workerRepository.create({ id: workerId, name: "Worker", tokenHash: WORKER_TOKEN, maxConcurrency: 1, capabilities: ["INSPECT_SCENE_EVIDENCE"] }, NOW);
    const job = await jobRepository.create(
      { id: randomUUID(), workerId, projectId: PROJECT_ID, operation: "INSPECT_SCENE_EVIDENCE", payload: sceneEvidencePayload() },
      NOW
    );
    const deps = { jobRepository, workerRepository, sceneEvidencePreviewRepository, assetStorage, verifyToken, maxUploadBytes: 10_000_000, now: () => NOW };
    await expect(uploadSceneEvidencePreview(deps, workerId, job.id, WORKER_TOKEN, { mimeType: "image/png", buffer: Buffer.from("x") })).rejects.toThrow(JobConflictError);
  });

  it("records a real scene-evidence preview with server-computed sha256/byteSize, attributed to the job's own manifestCompositionId/sourceProjectSha256", async () => {
    const { deps, workerId, jobId, sceneEvidencePreviewRepository } = await setup();
    const buffer = Buffer.from("real png bytes");
    const record = await uploadSceneEvidencePreview(deps, workerId, jobId, WORKER_TOKEN, { mimeType: "image/png", buffer });

    expect(record.jobId).toBe(jobId);
    expect(record.projectId).toBe(PROJECT_ID);
    expect(record.manifestCompositionId).toBe("comp-1");
    expect(record.sourceProjectSha256).toBe(SHA);
    expect(record.byteSize).toBe(buffer.length);

    const latest = await sceneEvidencePreviewRepository.findLatestForComposition(PROJECT_ID, "comp-1");
    expect(latest?.id).toBe(record.id);
  });

  it("is idempotent by jobId - a duplicate upload for the same job is a no-op returning the existing record", async () => {
    const { deps, workerId, jobId, assetStorage } = await setup();
    const buffer = Buffer.from("real png bytes");
    const first = await uploadSceneEvidencePreview(deps, workerId, jobId, WORKER_TOKEN, { mimeType: "image/png", buffer });
    const second = await uploadSceneEvidencePreview(deps, workerId, jobId, WORKER_TOKEN, { mimeType: "image/png", buffer });

    expect(second.id).toBe(first.id);
    expect(assetStorage.has(first.storageKey)).toBe(true);
  });
});
