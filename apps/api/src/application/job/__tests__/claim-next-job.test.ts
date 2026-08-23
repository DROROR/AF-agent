import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateWorkerToken, hashToken, verifyToken } from "../../../infrastructure/auth/token.js";
import { UnauthorizedError } from "../../../errors/app-error.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { claimNextJob } from "../claim-next-job.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const STALE_AFTER_MS = 30_000;

async function setupWorker(workerRepository: InMemoryWorkerRepository, maxConcurrency = 1) {
  const workerId = randomUUID();
  const token = generateWorkerToken();
  const tokenHash = await hashToken(token);
  await workerRepository.create({ id: workerId, name: "Worker", tokenHash, maxConcurrency, capabilities: [] }, FIXED_NOW);
  // A worker only legitimately claims jobs while actively heartbeating - a
  // freshly-created worker with no heartbeat yet is correctly treated as
  // stale by sweepStaleJobs (isHeartbeatStale: "never reported in" = stale),
  // which would otherwise fail its own just-claimed jobs out from under it
  // on the very next claim attempt in these tests.
  await workerRepository.updateHeartbeat(
    workerId,
    { aeStatus: "UNKNOWN", mcpStatus: "UNKNOWN", aeVersion: null, currentJobId: null },
    FIXED_NOW
  );
  return { workerId, token };
}

function deps(jobRepository: InMemoryJobRepository, workerRepository: InMemoryWorkerRepository) {
  return { jobRepository, workerRepository, verifyToken, now: () => FIXED_NOW, staleAfterMs: STALE_AFTER_MS };
}

describe("claimNextJob", () => {
  it("rejects a missing/invalid worker token", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId } = await setupWorker(workerRepository);

    await expect(claimNextJob(deps(jobRepository, workerRepository), workerId, "wrong-token")).rejects.toThrow(
      UnauthorizedError
    );
  });

  it("rejects a token for a worker ID that does not exist, same as an invalid token", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    await expect(
      claimNextJob(deps(jobRepository, workerRepository), randomUUID(), "any-token")
    ).rejects.toThrow(UnauthorizedError);
  });

  it("returns null (not an error) when there is nothing queued", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token } = await setupWorker(workerRepository);

    const result = await claimNextJob(deps(jobRepository, workerRepository), workerId, token);
    expect(result).toBeNull();
  });

  it("a worker can only claim jobs assigned to itself, never another worker's job", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId: workerA, token: tokenA } = await setupWorker(workerRepository);
    const { workerId: workerB } = await setupWorker(workerRepository);

    await jobRepository.create(
      { id: randomUUID(), workerId: workerB, operation: "INSPECT_TEMPLATE", payload: {} },
      FIXED_NOW
    );

    const result = await claimNextJob(deps(jobRepository, workerRepository), workerA, tokenA);
    expect(result).toBeNull();
  });

  it("claims its own queued job and marks it CLAIMED", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token } = await setupWorker(workerRepository);
    const jobId = randomUUID();
    await jobRepository.create({ id: jobId, workerId, operation: "INSPECT_TEMPLATE", payload: {} }, FIXED_NOW);

    const result = await claimNextJob(deps(jobRepository, workerRepository), workerId, token);
    expect(result?.jobId).toBe(jobId);
    expect(result?.status).toBe("CLAIMED");
  });

  it("does not let the same job be claimed twice (duplicate claim prevented)", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token } = await setupWorker(workerRepository);
    await jobRepository.create(
      { id: randomUUID(), workerId, operation: "INSPECT_TEMPLATE", payload: {} },
      FIXED_NOW
    );

    const first = await claimNextJob(deps(jobRepository, workerRepository), workerId, token);
    const second = await claimNextJob(deps(jobRepository, workerRepository), workerId, token);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("a worker with maxConcurrency=1 cannot claim a second job while one is already CLAIMED/RUNNING", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token } = await setupWorker(workerRepository, 1);
    await jobRepository.create(
      { id: randomUUID(), workerId, operation: "INSPECT_TEMPLATE", payload: {} },
      FIXED_NOW
    );
    await jobRepository.create(
      { id: randomUUID(), workerId, operation: "INSPECT_TEMPLATE", payload: {} },
      FIXED_NOW
    );

    const first = await claimNextJob(deps(jobRepository, workerRepository), workerId, token);
    const second = await claimNextJob(deps(jobRepository, workerRepository), workerId, token);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("cannot claim a job that already completed", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token } = await setupWorker(workerRepository);
    const jobId = randomUUID();
    await jobRepository.create({ id: jobId, workerId, operation: "INSPECT_TEMPLATE", payload: {} }, FIXED_NOW);
    await jobRepository.claimNextForWorker(workerId, 1, FIXED_NOW);
    await jobRepository.updateStatus(jobId, workerId, { expectedCurrentStatus: "CLAIMED", status: "RUNNING" }, FIXED_NOW);
    await jobRepository.updateStatus(
      jobId,
      workerId,
      { expectedCurrentStatus: "RUNNING", status: "SUCCEEDED", result: { ok: true } },
      FIXED_NOW
    );

    const result = await claimNextJob(deps(jobRepository, workerRepository), workerId, token);
    expect(result).toBeNull();
  });
});
