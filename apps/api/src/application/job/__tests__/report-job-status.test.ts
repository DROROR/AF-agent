import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateWorkerToken, hashToken, verifyToken } from "../../../infrastructure/auth/token.js";
import { JobConflictError, JobNotFoundError, UnauthorizedError } from "../../../errors/app-error.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { reportJobStatus } from "../report-job-status.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

async function setupClaimedJob(workerRepository: InMemoryWorkerRepository, jobRepository: InMemoryJobRepository) {
  const workerId = randomUUID();
  const token = generateWorkerToken();
  const tokenHash = await hashToken(token);
  await workerRepository.create({ id: workerId, name: "Worker", tokenHash, maxConcurrency: 1, capabilities: [] }, FIXED_NOW);
  const jobId = randomUUID();
  await jobRepository.create({ id: jobId, workerId, operation: "INSPECT_TEMPLATE", payload: {} }, FIXED_NOW);
  await jobRepository.claimNextForWorker(workerId, 1, FIXED_NOW);
  return { workerId, token, jobId };
}

function deps(jobRepository: InMemoryJobRepository, workerRepository: InMemoryWorkerRepository) {
  return { jobRepository, workerRepository, verifyToken, now: () => FIXED_NOW };
}

describe("reportJobStatus", () => {
  it("rejects a missing/invalid worker token", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { jobId } = await setupClaimedJob(workerRepository, jobRepository);

    await expect(
      reportJobStatus(deps(jobRepository, workerRepository), randomUUID(), jobId, "wrong", { status: "RUNNING" })
    ).rejects.toThrow(UnauthorizedError);
  });

  it("applies a valid CLAIMED -> RUNNING transition", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token, jobId } = await setupClaimedJob(workerRepository, jobRepository);

    const dto = await reportJobStatus(deps(jobRepository, workerRepository), workerId, jobId, token, {
      status: "RUNNING"
    });
    expect(dto.status).toBe("RUNNING");
    expect(dto.startedAt).not.toBeNull();
  });

  it("rejects an invalid state transition (e.g. CLAIMED straight to SUCCEEDED)", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token, jobId } = await setupClaimedJob(workerRepository, jobRepository);

    await expect(
      reportJobStatus(deps(jobRepository, workerRepository), workerId, jobId, token, { status: "SUCCEEDED" })
    ).rejects.toThrow(JobConflictError);
  });

  it("a worker cannot report status for a job that belongs to a different worker", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { jobId } = await setupClaimedJob(workerRepository, jobRepository);
    const otherToken = generateWorkerToken();
    const otherWorkerId = randomUUID();
    await workerRepository.create(
      { id: otherWorkerId, name: "Other", tokenHash: await hashToken(otherToken), maxConcurrency: 1, capabilities: [] },
      FIXED_NOW
    );

    await expect(
      reportJobStatus(deps(jobRepository, workerRepository), otherWorkerId, jobId, otherToken, { status: "RUNNING" })
    ).rejects.toThrow(JobNotFoundError);
  });

  it("rejects reporting against a job that already completed - completed jobs cannot be reclaimed/reprocessed", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token, jobId } = await setupClaimedJob(workerRepository, jobRepository);
    await reportJobStatus(deps(jobRepository, workerRepository), workerId, jobId, token, { status: "RUNNING" });
    await reportJobStatus(deps(jobRepository, workerRepository), workerId, jobId, token, {
      status: "SUCCEEDED",
      result: { ok: true }
    });

    await expect(
      reportJobStatus(deps(jobRepository, workerRepository), workerId, jobId, token, { status: "RUNNING" })
    ).rejects.toThrow(JobConflictError);
  });

  it("stores a typed error and marks completedAt on a FAILED report", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token, jobId } = await setupClaimedJob(workerRepository, jobRepository);
    await reportJobStatus(deps(jobRepository, workerRepository), workerId, jobId, token, { status: "RUNNING" });

    const dto = await reportJobStatus(deps(jobRepository, workerRepository), workerId, jobId, token, {
      status: "FAILED",
      error: { code: "NOT_AVAILABLE", message: "no bridge yet" }
    });
    expect(dto.status).toBe("FAILED");
    expect(dto.error).toEqual({ code: "NOT_AVAILABLE", message: "no bridge yet" });
    expect(dto.completedAt).not.toBeNull();
  });

  it("throws JobNotFoundError for a job ID that does not exist at all", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token } = await setupClaimedJob(workerRepository, jobRepository);

    await expect(
      reportJobStatus(deps(jobRepository, workerRepository), workerId, randomUUID(), token, { status: "RUNNING" })
    ).rejects.toThrow(JobNotFoundError);
  });
});
