import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateWorkerToken, hashToken, verifyToken } from "../../../infrastructure/auth/token.js";
import { UnauthorizedError } from "../../../errors/app-error.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { listActiveJobsForWorker } from "../list-active-jobs-for-worker.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

async function setupWorker(workerRepository: InMemoryWorkerRepository) {
  const workerId = randomUUID();
  const token = generateWorkerToken();
  const tokenHash = await hashToken(token);
  await workerRepository.create({ id: workerId, name: "Worker", tokenHash, maxConcurrency: 1, capabilities: [] }, FIXED_NOW);
  return { workerId, token };
}

function deps(jobRepository: InMemoryJobRepository, workerRepository: InMemoryWorkerRepository) {
  return { jobRepository, workerRepository, verifyToken };
}

/**
 * P3/P4/P5 stuck-job recovery (2026-09-04): the one new API-side read a
 * freshly restarted worker process uses to discover a job left behind by a
 * worker process that never reported its own outcome. Deliberately adds no
 * new way to MUTATE a job - reconciliation reuses the existing, already
 * fully-tested /report endpoint (report-job-status.ts).
 */
describe("listActiveJobsForWorker", () => {
  it("rejects a missing/invalid worker token", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId } = await setupWorker(workerRepository);

    await expect(listActiveJobsForWorker(deps(jobRepository, workerRepository), workerId, "wrong-token")).rejects.toThrow(
      UnauthorizedError
    );
  });

  it("rejects a token for a worker ID that does not exist", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    await expect(
      listActiveJobsForWorker(deps(jobRepository, workerRepository), randomUUID(), "any-token")
    ).rejects.toThrow(UnauthorizedError);
  });

  it("returns an empty list when nothing is active - the normal case on every ordinary restart", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token } = await setupWorker(workerRepository);

    const jobs = await listActiveJobsForWorker(deps(jobRepository, workerRepository), workerId, token);
    expect(jobs).toEqual([]);
  });

  it("returns a job stuck RUNNING (matching the real 2026-09-04 incident) - the one case this exists for", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId, token } = await setupWorker(workerRepository);
    const jobId = randomUUID();
    await jobRepository.create({ id: jobId, workerId, operation: "INSPECT_SCENE_EVIDENCE", payload: {} }, FIXED_NOW);
    await jobRepository.claimNextForWorker(workerId, 1, FIXED_NOW);
    await jobRepository.updateStatus(jobId, workerId, { expectedCurrentStatus: "CLAIMED", status: "RUNNING" }, FIXED_NOW);

    const jobs = await listActiveJobsForWorker(deps(jobRepository, workerRepository), workerId, token);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.jobId).toBe(jobId);
    expect(jobs[0]?.status).toBe("RUNNING");
  });

  it("never returns another worker's job", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const { workerId: workerA, token: tokenA } = await setupWorker(workerRepository);
    const { workerId: workerB } = await setupWorker(workerRepository);
    await jobRepository.create({ id: randomUUID(), workerId: workerB, operation: "INSPECT_TEMPLATE", payload: {} }, FIXED_NOW);
    await jobRepository.claimNextForWorker(workerB, 1, FIXED_NOW);

    const jobs = await listActiveJobsForWorker(deps(jobRepository, workerRepository), workerA, tokenA);
    expect(jobs).toEqual([]);
  });

  it("never returns an already-terminal job", async () => {
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

    const jobs = await listActiveJobsForWorker(deps(jobRepository, workerRepository), workerId, token);
    expect(jobs).toEqual([]);
  });
});
