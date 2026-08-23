import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { sweepStaleJobs } from "../sweep-stale-jobs.js";

const NOW = new Date("2026-01-01T00:10:00.000Z");
const STALE_AFTER_MS = 30_000;

async function setupWorkerWithHeartbeat(workerRepository: InMemoryWorkerRepository, lastHeartbeatAt: Date | null) {
  const workerId = randomUUID();
  await workerRepository.create({ id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: [] }, NOW);
  if (lastHeartbeatAt) {
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "UNKNOWN", mcpStatus: "UNKNOWN", aeVersion: null, currentJobId: null },
      lastHeartbeatAt
    );
  }
  return workerId;
}

describe("sweepStaleJobs (recovery: worker goes offline while a job is active)", () => {
  it("fails a RUNNING job whose worker's heartbeat has gone stale, with a typed WORKER_OFFLINE error", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupWorkerWithHeartbeat(workerRepository, new Date(NOW.getTime() - STALE_AFTER_MS - 1_000));
    const jobId = randomUUID();
    await jobRepository.create({ id: jobId, workerId, operation: "INSPECT_TEMPLATE", payload: {} }, NOW);
    await jobRepository.claimNextForWorker(workerId, 1, NOW);
    await jobRepository.updateStatus(jobId, workerId, { expectedCurrentStatus: "CLAIMED", status: "RUNNING" }, NOW);

    const affected = await sweepStaleJobs({ jobRepository, now: () => NOW, staleAfterMs: STALE_AFTER_MS });

    expect(affected).toEqual([jobId]);
    const job = await jobRepository.findById(jobId);
    expect(job?.status).toBe("FAILED");
    expect(job?.error).toEqual({
      code: "WORKER_OFFLINE",
      message: "worker heartbeat went stale while this job was active"
    });
  });

  it("does not touch a job whose worker heartbeat is still fresh", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupWorkerWithHeartbeat(workerRepository, new Date(NOW.getTime() - 1_000));
    const jobId = randomUUID();
    await jobRepository.create({ id: jobId, workerId, operation: "INSPECT_TEMPLATE", payload: {} }, NOW);
    await jobRepository.claimNextForWorker(workerId, 1, NOW);

    const affected = await sweepStaleJobs({ jobRepository, now: () => NOW, staleAfterMs: STALE_AFTER_MS });

    expect(affected).toEqual([]);
    const job = await jobRepository.findById(jobId);
    expect(job?.status).toBe("CLAIMED");
  });

  it("fails an active job for a worker that has never sent a heartbeat at all", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupWorkerWithHeartbeat(workerRepository, null);
    const jobId = randomUUID();
    await jobRepository.create({ id: jobId, workerId, operation: "INSPECT_TEMPLATE", payload: {} }, NOW);
    await jobRepository.claimNextForWorker(workerId, 1, NOW);

    const affected = await sweepStaleJobs({ jobRepository, now: () => NOW, staleAfterMs: STALE_AFTER_MS });
    expect(affected).toEqual([jobId]);
  });

  it("never touches a job that is already terminal", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupWorkerWithHeartbeat(workerRepository, null);
    const jobId = randomUUID();
    await jobRepository.create({ id: jobId, workerId, operation: "INSPECT_TEMPLATE", payload: {} }, NOW);
    await jobRepository.claimNextForWorker(workerId, 1, NOW);
    await jobRepository.updateStatus(jobId, workerId, { expectedCurrentStatus: "CLAIMED", status: "CANCELLED" }, NOW);

    const affected = await sweepStaleJobs({ jobRepository, now: () => NOW, staleAfterMs: STALE_AFTER_MS });
    expect(affected).toEqual([]);
  });
});
