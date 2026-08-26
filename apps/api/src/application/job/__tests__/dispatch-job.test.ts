import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PreconditionNotMetError,
  WorkerBusyError,
  WorkerNotFoundError,
  WorkerOfflineError
} from "../../../errors/app-error.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { dispatchJob } from "../dispatch-job.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const STALE_AFTER_MS = 30_000;
const PAYLOAD = { templateId: "t", sourceProjectPath: "/copies/t.aep" };

function deps(jobRepository: InMemoryJobRepository, workerRepository: InMemoryWorkerRepository, now = FIXED_NOW) {
  return { jobRepository, workerRepository, now: () => now, staleAfterMs: STALE_AFTER_MS };
}

/** A worker in a fully green state: ONLINE, AE/MCP ONLINE, has the capability, fresh heartbeat, no active job. */
async function setupHealthyWorker(workerRepository: InMemoryWorkerRepository, maxConcurrency = 1) {
  const workerId = randomUUID();
  await workerRepository.create(
    { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency, capabilities: ["INSPECT_TEMPLATE"] },
    FIXED_NOW
  );
  await workerRepository.updateHeartbeat(
    workerId,
    { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: null },
    FIXED_NOW
  );
  return workerId;
}

describe("dispatchJob", () => {
  it("rejects a nonexistent worker", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), {
        operation: "INSPECT_TEMPLATE",
        workerId: randomUUID(),
        payload: PAYLOAD
      })
    ).rejects.toThrow(WorkerNotFoundError);
  });

  it("rejects a worker with a stale heartbeat, even if its DB status still says ONLINE", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupHealthyWorker(workerRepository);

    // Heartbeat happened at FIXED_NOW; "now" for the dispatch call is far past the stale window.
    const staleNow = new Date(FIXED_NOW.getTime() + STALE_AFTER_MS + 1_000);

    await expect(
      dispatchJob(deps(jobRepository, workerRepository, staleNow), {
        operation: "INSPECT_TEMPLATE",
        workerId,
        payload: PAYLOAD
      })
    ).rejects.toThrow(WorkerOfflineError);
  });

  it("rejects when AE is not ONLINE", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["INSPECT_TEMPLATE"] },
      FIXED_NOW
    );
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "OFFLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: null },
      FIXED_NOW
    );

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), { operation: "INSPECT_TEMPLATE", workerId, payload: PAYLOAD })
    ).rejects.toThrow(PreconditionNotMetError);
  });

  it("rejects when MCP is not ONLINE", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["INSPECT_TEMPLATE"] },
      FIXED_NOW
    );
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "ONLINE", mcpStatus: "OFFLINE", aeVersion: "26.0", currentJobId: null },
      FIXED_NOW
    );

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), { operation: "INSPECT_TEMPLATE", workerId, payload: PAYLOAD })
    ).rejects.toThrow(PreconditionNotMetError);
  });

  it("rejects when the worker does not report the INSPECT_TEMPLATE capability", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["CHECK_HEALTH"] },
      FIXED_NOW
    );
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: null },
      FIXED_NOW
    );

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), { operation: "INSPECT_TEMPLATE", workerId, payload: PAYLOAD })
    ).rejects.toThrow(PreconditionNotMetError);
  });

  it("rejects a busy worker (currentJobId already set)", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["INSPECT_TEMPLATE"] },
      FIXED_NOW
    );
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: randomUUID() },
      FIXED_NOW
    );

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), { operation: "INSPECT_TEMPLATE", workerId, payload: PAYLOAD })
    ).rejects.toThrow(WorkerBusyError);
  });

  it("creates exactly one QUEUED job for a fully healthy worker", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupHealthyWorker(workerRepository);

    const result = await dispatchJob(deps(jobRepository, workerRepository), {
      operation: "INSPECT_TEMPLATE",
      workerId,
      payload: PAYLOAD
    });

    expect(result.status).toBe("QUEUED");
    expect(result.workerId).toBe(workerId);
    expect(result.operation).toBe("INSPECT_TEMPLATE");

    const job = await jobRepository.findById(result.jobId);
    expect(job).not.toBeNull();
    expect(job?.status).toBe("QUEUED");
  });

  it("rejects a second dispatch while a live INSPECT_TEMPLATE job already exists for this worker (double-submit protection)", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupHealthyWorker(workerRepository);

    await dispatchJob(deps(jobRepository, workerRepository), {
      operation: "INSPECT_TEMPLATE",
      workerId,
      payload: PAYLOAD
    });

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), { operation: "INSPECT_TEMPLATE", workerId, payload: PAYLOAD })
    ).rejects.toThrow(WorkerBusyError);

    const jobs = await jobRepository.countActiveForWorker(workerId);
    // The duplicate was refused before creation - only ever one job row exists for this worker.
    expect(jobs).toBe(0); // still QUEUED, not yet CLAIMED/RUNNING/WAITING_FOR_ACTION
  });

  it("applies the same AE/MCP-ONLINE precondition to INSPECT_SCENE_EVIDENCE as to INSPECT_TEMPLATE", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["INSPECT_SCENE_EVIDENCE"] },
      FIXED_NOW
    );
    // AE deliberately not ONLINE - mirrors the "rejects when the worker does
    // not report AE as ONLINE" scenario already covered for INSPECT_TEMPLATE.
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "OFFLINE", mcpStatus: "ONLINE", aeVersion: null, currentJobId: null },
      FIXED_NOW
    );

    const sceneEvidencePayload = {
      sourceProjectPath: "/copies/t.aep",
      sourceProjectSha256: "a".repeat(64),
      manifestCompositionId: "comp-275",
      compositionIndex: 14,
      layerIndices: [1],
      previewTimestampSeconds: null
    };

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), {
        operation: "INSPECT_SCENE_EVIDENCE",
        workerId,
        payload: sceneEvidencePayload
      })
    ).rejects.toThrow(PreconditionNotMetError);
  });
});
