import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SceneEditCheckpoint } from "@dyo/schemas";
import { generateWorkerToken, hashToken, verifyToken } from "../../../infrastructure/auth/token.js";
import { JobConflictError, JobNotFoundError, UnauthorizedError } from "../../../errors/app-error.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { reportJobStatus } from "../report-job-status.js";
import { reportJobCheckpoint } from "../report-job-checkpoint.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

function checkpoint(completedOperationIndices: number[], failureReason: string | null = null): SceneEditCheckpoint {
  return {
    completedOperationIndices,
    checkpointBeforeAt: FIXED_NOW.toISOString(),
    checkpointAfterAt: FIXED_NOW.toISOString(),
    failureReason
  };
}

async function setupRunningExecuteFrameJob(
  workerRepository: InMemoryWorkerRepository,
  jobRepository: InMemoryJobRepository
) {
  const workerId = randomUUID();
  const token = generateWorkerToken();
  const tokenHash = await hashToken(token);
  await workerRepository.create({ id: workerId, name: "Worker", tokenHash, maxConcurrency: 1, capabilities: [] }, FIXED_NOW);
  const jobId = randomUUID();
  await jobRepository.create({ id: jobId, workerId, operation: "EXECUTE_FRAME", payload: {} }, FIXED_NOW);
  await jobRepository.claimNextForWorker(workerId, 1, FIXED_NOW);
  await reportJobStatus(deps(jobRepository, workerRepository), workerId, jobId, token, { status: "RUNNING" });
  return { workerId, token, jobId };
}

function deps(jobRepository: InMemoryJobRepository, workerRepository: InMemoryWorkerRepository) {
  return { jobRepository, workerRepository, verifyToken, now: () => FIXED_NOW };
}

describe("reportJobCheckpoint", () => {
  it("rejects a missing/invalid worker token", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { jobId } = await setupRunningExecuteFrameJob(workerRepository, jobRepository);

    await expect(
      reportJobCheckpoint(deps(jobRepository, workerRepository), randomUUID(), jobId, "wrong", checkpoint([0]))
    ).rejects.toThrow(UnauthorizedError);
  });

  it("a worker cannot update the checkpoint of a job that belongs to a different worker", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { jobId } = await setupRunningExecuteFrameJob(workerRepository, jobRepository);
    const otherToken = generateWorkerToken();
    const otherWorkerId = randomUUID();
    await workerRepository.create(
      { id: otherWorkerId, name: "Other", tokenHash: await hashToken(otherToken), maxConcurrency: 1, capabilities: [] },
      FIXED_NOW
    );

    await expect(
      reportJobCheckpoint(deps(jobRepository, workerRepository), otherWorkerId, jobId, otherToken, checkpoint([0]))
    ).rejects.toThrow(JobNotFoundError);
  });

  it("throws JobNotFoundError for a job ID that does not exist at all", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token } = await setupRunningExecuteFrameJob(workerRepository, jobRepository);

    await expect(
      reportJobCheckpoint(deps(jobRepository, workerRepository), workerId, randomUUID(), token, checkpoint([0]))
    ).rejects.toThrow(JobNotFoundError);
  });

  it("rejects a checkpoint update against a job that is not RUNNING (e.g. still CLAIMED)", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    const token = generateWorkerToken();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: await hashToken(token), maxConcurrency: 1, capabilities: [] },
      FIXED_NOW
    );
    const jobId = randomUUID();
    await jobRepository.create({ id: jobId, workerId, operation: "EXECUTE_FRAME", payload: {} }, FIXED_NOW);
    await jobRepository.claimNextForWorker(workerId, 1, FIXED_NOW);
    // Deliberately never transitioned to RUNNING - still CLAIMED.

    await expect(
      reportJobCheckpoint(deps(jobRepository, workerRepository), workerId, jobId, token, checkpoint([0]))
    ).rejects.toThrow(JobConflictError);
  });

  it("rejects a checkpoint update against a job that already completed", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token, jobId } = await setupRunningExecuteFrameJob(workerRepository, jobRepository);
    await reportJobStatus(deps(jobRepository, workerRepository), workerId, jobId, token, {
      status: "SUCCEEDED",
      result: { ok: true }
    });

    await expect(
      reportJobCheckpoint(deps(jobRepository, workerRepository), workerId, jobId, token, checkpoint([0]))
    ).rejects.toThrow(JobConflictError);
  });

  it("rejects a checkpoint update for an operation that does not define checkpoint semantics (only EXECUTE_FRAME does today)", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    const token = generateWorkerToken();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: await hashToken(token), maxConcurrency: 1, capabilities: [] },
      FIXED_NOW
    );
    const jobId = randomUUID();
    await jobRepository.create({ id: jobId, workerId, operation: "INSPECT_TEMPLATE", payload: {} }, FIXED_NOW);
    await jobRepository.claimNextForWorker(workerId, 1, FIXED_NOW);
    await reportJobStatus(deps(jobRepository, workerRepository), workerId, jobId, token, { status: "RUNNING" });

    await expect(
      reportJobCheckpoint(deps(jobRepository, workerRepository), workerId, jobId, token, checkpoint([0]))
    ).rejects.toThrow(JobConflictError);
  });

  it("rejects a malformed checkpoint that does not match sceneEditCheckpointSchema", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token, jobId } = await setupRunningExecuteFrameJob(workerRepository, jobRepository);

    await expect(
      reportJobCheckpoint(deps(jobRepository, workerRepository), workerId, jobId, token, { garbage: true })
    ).rejects.toThrow(JobConflictError);
  });

  it("accepts a valid first checkpoint update while RUNNING, without changing status", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token, jobId } = await setupRunningExecuteFrameJob(workerRepository, jobRepository);

    const dto = await reportJobCheckpoint(deps(jobRepository, workerRepository), workerId, jobId, token, checkpoint([0]));
    expect(dto.status).toBe("RUNNING");
    expect(dto.checkpoint).toEqual(checkpoint([0]));
  });

  it("accepts a monotonic (superset) follow-up checkpoint update", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token, jobId } = await setupRunningExecuteFrameJob(workerRepository, jobRepository);

    await reportJobCheckpoint(deps(jobRepository, workerRepository), workerId, jobId, token, checkpoint([0]));
    const dto = await reportJobCheckpoint(deps(jobRepository, workerRepository), workerId, jobId, token, checkpoint([0, 1]));
    expect(dto.checkpoint).toEqual(checkpoint([0, 1]));
  });

  it("a duplicate checkpoint update (same completed indices) is idempotent", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token, jobId } = await setupRunningExecuteFrameJob(workerRepository, jobRepository);

    await reportJobCheckpoint(deps(jobRepository, workerRepository), workerId, jobId, token, checkpoint([0, 1]));
    const dto = await reportJobCheckpoint(deps(jobRepository, workerRepository), workerId, jobId, token, checkpoint([0, 1]));
    expect(dto.status).toBe("RUNNING");
    expect(dto.checkpoint).toEqual(checkpoint([0, 1]));
  });

  it("rejects a checkpoint regression (missing an already-recorded completed operation index)", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token, jobId } = await setupRunningExecuteFrameJob(workerRepository, jobRepository);

    await reportJobCheckpoint(deps(jobRepository, workerRepository), workerId, jobId, token, checkpoint([0, 1]));

    await expect(
      reportJobCheckpoint(deps(jobRepository, workerRepository), workerId, jobId, token, checkpoint([0]))
    ).rejects.toThrow(JobConflictError);

    // The regression attempt must not have overwritten the already-recorded progress.
    const stillIntact = await jobRepository.findById(jobId);
    expect(stillIntact?.checkpoint).toEqual(checkpoint([0, 1]));
  });

  it("never marks the job SUCCEEDED/FAILED via a checkpoint update, even one carrying a failureReason", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token, jobId } = await setupRunningExecuteFrameJob(workerRepository, jobRepository);

    const dto = await reportJobCheckpoint(
      deps(jobRepository, workerRepository),
      workerId,
      jobId,
      token,
      checkpoint([0], "operation 1 failed: layer not found")
    );
    expect(dto.status).toBe("RUNNING");
  });
});
