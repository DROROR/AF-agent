import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { JobConflictError, JobNotFoundError, UnauthorizedError } from "../../../errors/app-error.js";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryExecutionSessionRepository } from "../../execution-session/test-support/in-memory-execution-session-repository.js";
import { InMemoryFullPreviewArtifactRepository } from "../../execution-session/test-support/in-memory-full-preview-artifact-repository.js";
import { InMemoryAssetStorage } from "../../asset/test-support/in-memory-asset-storage.js";
import { uploadFullPreview } from "../upload-full-preview.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const WORKER_TOKEN = "real-worker-token";

async function verifyToken(token: string, storedHash: string): Promise<boolean> {
  return token === storedHash;
}

function fullPreviewPayload(executionSessionId: string) {
  return {
    projectId: PROJECT_ID,
    executionSessionId,
    sourceProjectPath: "C:\\vidio agent\\White App Promo.aep",
    sourceProjectSha256: "a".repeat(64),
    expectedWorkingProjectSha256: "d".repeat(64),
    aeProjectItemIndex: 5,
    compositionName: "Landscape Master",
    renderSettingsTemplateName: "Best Settings",
    outputModuleTemplateName: "H.264 - Match Source"
  };
}

async function setup() {
  const jobRepository = new InMemoryJobRepository();
  const workerRepository = new InMemoryWorkerRepository();
  const executionSessionRepository = new InMemoryExecutionSessionRepository();
  const fullPreviewArtifactRepository = new InMemoryFullPreviewArtifactRepository();
  const assetStorage = new InMemoryAssetStorage();
  const workerId = randomUUID();
  await workerRepository.create({ id: workerId, name: "Worker", tokenHash: WORKER_TOKEN, maxConcurrency: 1, capabilities: ["CREATE_PREVIEW"] }, NOW);
  const session = await executionSessionRepository.create(
    { id: randomUUID(), projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: workerId },
    NOW
  );
  const job = await jobRepository.create({ id: randomUUID(), workerId, projectId: PROJECT_ID, operation: "CREATE_PREVIEW", payload: fullPreviewPayload(session.id) }, NOW);
  await jobRepository.updateStatus(job.id, workerId, { expectedCurrentStatus: "QUEUED", status: "CLAIMED" }, NOW);
  await jobRepository.updateStatus(job.id, workerId, { expectedCurrentStatus: "CLAIMED", status: "RUNNING" }, NOW);
  const deps = {
    jobRepository,
    workerRepository,
    executionSessionRepository,
    fullPreviewArtifactRepository,
    assetStorage,
    verifyToken,
    maxUploadBytes: 10_000_000,
    now: () => NOW
  };
  return { deps, workerId, jobId: job.id, session, executionSessionRepository, fullPreviewArtifactRepository, assetStorage };
}

describe("uploadFullPreview", () => {
  it("throws UnauthorizedError for a wrong token", async () => {
    const { deps, workerId, jobId } = await setup();
    await expect(uploadFullPreview(deps, workerId, jobId, "wrong-token", { mimeType: "video/mp4", buffer: Buffer.from("x") })).rejects.toThrow(UnauthorizedError);
  });

  it("throws JobNotFoundError for a job belonging to a different worker", async () => {
    const { deps, jobId } = await setup();
    const otherWorkerId = randomUUID();
    await deps.workerRepository.create({ id: otherWorkerId, name: "Other Worker", tokenHash: WORKER_TOKEN, maxConcurrency: 1, capabilities: ["CREATE_PREVIEW"] }, NOW);
    await expect(uploadFullPreview(deps, otherWorkerId, jobId, WORKER_TOKEN, { mimeType: "video/mp4", buffer: Buffer.from("x") })).rejects.toThrow(JobNotFoundError);
  });

  it("refuses when the job's operation is not CREATE_PREVIEW", async () => {
    const { deps, workerId } = await setup();
    const otherJob = await deps.jobRepository.create({ id: randomUUID(), workerId, projectId: PROJECT_ID, operation: "RENDER", payload: {} }, NOW);
    await deps.jobRepository.updateStatus(otherJob.id, workerId, { expectedCurrentStatus: "QUEUED", status: "CLAIMED" }, NOW);
    await deps.jobRepository.updateStatus(otherJob.id, workerId, { expectedCurrentStatus: "CLAIMED", status: "RUNNING" }, NOW);
    await expect(uploadFullPreview(deps, workerId, otherJob.id, WORKER_TOKEN, { mimeType: "video/mp4", buffer: Buffer.from("x") })).rejects.toThrow(JobConflictError);
  });

  it("records a real full-preview artifact directly (no separate staging table) with server-computed sha256/byteSize, and resets fullPreviewApproved to false", async () => {
    const { deps, workerId, jobId, session, executionSessionRepository, fullPreviewArtifactRepository } = await setup();
    await executionSessionRepository.setFullPreviewApproved(session.id, true, NOW); // simulate a prior approval for OLDER content

    const buffer = Buffer.from("real video bytes");
    const record = await uploadFullPreview(deps, workerId, jobId, WORKER_TOKEN, { mimeType: "video/mp4", buffer });

    expect(record.executionSessionId).toBe(session.id);
    expect(record.byteSize).toBe(buffer.length);
    expect(record.workingProjectSha256).toBe("d".repeat(64));

    const latest = await fullPreviewArtifactRepository.findLatestForSession(session.id);
    expect(latest?.id).toBe(record.id);

    // A genuinely NEW artifact must reset any prior approval - it was for different, now-superseded content.
    const updatedSession = await executionSessionRepository.findById(session.id);
    expect(updatedSession?.fullPreviewApproved).toBe(false);
  });

  it("is idempotent by jobId - a duplicate upload for the same job is a no-op returning the existing record", async () => {
    const { deps, workerId, jobId, assetStorage } = await setup();
    const buffer = Buffer.from("real video bytes");
    const first = await uploadFullPreview(deps, workerId, jobId, WORKER_TOKEN, { mimeType: "video/mp4", buffer });
    const second = await uploadFullPreview(deps, workerId, jobId, WORKER_TOKEN, { mimeType: "video/mp4", buffer });

    expect(second.id).toBe(first.id);
    expect(assetStorage.has(first.storageKey)).toBe(true);
  });
});
