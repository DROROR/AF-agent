import { describe, expect, it } from "vitest";
import { generateWorkerToken, hashToken, verifyToken } from "../../../infrastructure/auth/token.js";
import { WorkerNotFoundError } from "../../../errors/app-error.js";
import { InMemoryWorkerRepository } from "../test-support/in-memory-worker-repository.js";
import { registerWorker } from "../register-worker.js";
import { recordHeartbeat } from "../record-heartbeat.js";
import { listWorkers } from "../list-workers.js";
import { getWorker } from "../get-worker.js";

const REGISTERED_AT = new Date("2026-01-01T00:00:00.000Z");
const STALE_AFTER_MS = 30_000;

async function registerAndHeartbeat(repository: InMemoryWorkerRepository, heartbeatAt: Date) {
  const { workerId, workerToken } = await registerWorker(
    { repository, generateToken: generateWorkerToken, hashToken, now: () => REGISTERED_AT },
    { name: "Client PC 1", maxConcurrency: 1, capabilities: [] }
  );
  await recordHeartbeat({ repository, verifyToken, now: () => heartbeatAt }, workerId, workerToken, {
    aeStatus: "ONLINE",
    mcpStatus: "ONLINE",
    aeVersion: null,
    currentJobId: null
  });
  return workerId;
}

describe("listWorkers", () => {
  it("reports a worker with a fresh heartbeat as ONLINE", async () => {
    const repository = new InMemoryWorkerRepository();
    const heartbeatAt = REGISTERED_AT;
    await registerAndHeartbeat(repository, heartbeatAt);

    const now = new Date(heartbeatAt.getTime() + 5_000);
    const workers = await listWorkers({ repository, now: () => now, staleAfterMs: STALE_AFTER_MS });

    expect(workers).toHaveLength(1);
    expect(workers[0]?.status).toBe("ONLINE");
  });

  it("flips a worker to OFFLINE once its heartbeat goes stale (persisted, not just computed)", async () => {
    const repository = new InMemoryWorkerRepository();
    const heartbeatAt = REGISTERED_AT;
    const workerId = await registerAndHeartbeat(repository, heartbeatAt);

    const now = new Date(heartbeatAt.getTime() + STALE_AFTER_MS + 1);
    const workers = await listWorkers({ repository, now: () => now, staleAfterMs: STALE_AFTER_MS });

    expect(workers[0]?.status).toBe("OFFLINE");

    // Persisted, not just computed for this one response - re-reading confirms it stuck.
    const stored = await repository.findById(workerId);
    expect(stored?.status).toBe("OFFLINE");
  });

  it("supports multiple concurrently registered workers independently", async () => {
    const repository = new InMemoryWorkerRepository();
    await registerAndHeartbeat(repository, REGISTERED_AT);
    await registerAndHeartbeat(repository, REGISTERED_AT);

    const now = new Date(REGISTERED_AT.getTime() + 1_000);
    const workers = await listWorkers({ repository, now: () => now, staleAfterMs: STALE_AFTER_MS });

    expect(workers).toHaveLength(2);
    expect(workers.every((worker) => worker.status === "ONLINE")).toBe(true);
  });
});

describe("getWorker", () => {
  it("throws WorkerNotFoundError for an unknown ID", async () => {
    const repository = new InMemoryWorkerRepository();
    await expect(
      getWorker(
        { repository, now: () => REGISTERED_AT, staleAfterMs: STALE_AFTER_MS },
        "00000000-0000-0000-0000-000000000000"
      )
    ).rejects.toBeInstanceOf(WorkerNotFoundError);
  });

  it("sweeps staleness before returning a single worker", async () => {
    const repository = new InMemoryWorkerRepository();
    const workerId = await registerAndHeartbeat(repository, REGISTERED_AT);

    const now = new Date(REGISTERED_AT.getTime() + STALE_AFTER_MS + 1);
    const dto = await getWorker({ repository, now: () => now, staleAfterMs: STALE_AFTER_MS }, workerId);

    expect(dto.status).toBe("OFFLINE");
  });
});
