import { describe, expect, it } from "vitest";
import { generateWorkerToken, hashToken, verifyToken } from "../../../infrastructure/auth/token.js";
import { InMemoryWorkerRepository } from "../test-support/in-memory-worker-repository.js";
import { registerWorker } from "../register-worker.js";
import { recordHeartbeat } from "../record-heartbeat.js";
import { listWorkers } from "../list-workers.js";
import { getWorker } from "../get-worker.js";

const REGISTERED_AT = new Date("2026-01-01T00:00:00.000Z");
const STALE_AFTER_MS = 30_000;

async function setupWorker(
  repository: InMemoryWorkerRepository,
  heartbeatAt: Date,
  aeStatus: "ONLINE" | "OFFLINE" | "UNKNOWN" = "ONLINE",
  mcpStatus: "ONLINE" | "OFFLINE" | "UNKNOWN" = "ONLINE"
) {
  const { workerId, workerToken } = await registerWorker(
    { repository, generateToken: generateWorkerToken, hashToken, now: () => REGISTERED_AT },
    { name: "Client PC 1", maxConcurrency: 1, capabilities: ["EXECUTE_FRAME"] }
  );
  await recordHeartbeat({ repository, verifyToken, now: () => heartbeatAt }, workerId, workerToken, {
    aeStatus,
    mcpStatus,
    aeVersion: null,
    currentJobId: null
  });
  return workerId;
}

describe("Worker status UI truthfulness (hierarchical AE/MCP availability)", () => {
  // Scenario A: worker offline (stale heartbeat), last-known AE/MCP were ONLINE.
  it("A: never shows AE/MCP as ONLINE once the worker itself is offline, even if last-reported telemetry was ONLINE", async () => {
    const repository = new InMemoryWorkerRepository();
    const workerId = await setupWorker(repository, REGISTERED_AT, "ONLINE", "ONLINE");

    const now = new Date(REGISTERED_AT.getTime() + STALE_AFTER_MS + 1);
    const workers = await listWorkers({ repository, now: () => now, staleAfterMs: STALE_AFTER_MS });
    const worker = workers.find((w) => w.workerId === workerId);

    expect(worker?.status).toBe("OFFLINE");
    expect(worker?.aeAvailability).toBe("UNAVAILABLE");
    expect(worker?.mcpAvailability).toBe("UNAVAILABLE");
    // Last-known telemetry is preserved (never mutated), just not surfaced as current truth.
    expect(worker?.aeStatus).toBe("ONLINE");
    expect(worker?.mcpStatus).toBe("ONLINE");

    // Also true for the single-worker read path.
    const dto = await getWorker({ repository, now: () => now, staleAfterMs: STALE_AFTER_MS }, workerId);
    expect(dto.aeAvailability).toBe("UNAVAILABLE");
    expect(dto.mcpAvailability).toBe("UNAVAILABLE");
  });

  // Scenario B: worker online, AE online, MCP online.
  it("B: reports all three as Online when the worker is healthy and AE/MCP both report ONLINE", async () => {
    const repository = new InMemoryWorkerRepository();
    const workerId = await setupWorker(repository, REGISTERED_AT, "ONLINE", "ONLINE");

    const now = new Date(REGISTERED_AT.getTime() + 5_000);
    const workers = await listWorkers({ repository, now: () => now, staleAfterMs: STALE_AFTER_MS });
    const worker = workers.find((w) => w.workerId === workerId);

    expect(worker?.status).toBe("ONLINE");
    expect(worker?.aeAvailability).toBe("ONLINE");
    expect(worker?.mcpAvailability).toBe("ONLINE");
  });

  // Scenario C: worker online, AE offline, MCP online - exact real statuses, not blended.
  it("C: reports the exact real per-signal statuses when the worker is online but AE itself is offline", async () => {
    const repository = new InMemoryWorkerRepository();
    const workerId = await setupWorker(repository, REGISTERED_AT, "OFFLINE", "ONLINE");

    const now = new Date(REGISTERED_AT.getTime() + 5_000);
    const workers = await listWorkers({ repository, now: () => now, staleAfterMs: STALE_AFTER_MS });
    const worker = workers.find((w) => w.workerId === workerId);

    expect(worker?.status).toBe("ONLINE");
    expect(worker?.aeAvailability).toBe("OFFLINE");
    expect(worker?.mcpAvailability).toBe("ONLINE");
  });

  // Scenario D: worker heartbeat becomes stale while last telemetry remains Online.
  it("D: flips Worker to Offline and AE/MCP to Unavailable once the heartbeat goes stale, without mutating the historical telemetry row", async () => {
    const repository = new InMemoryWorkerRepository();
    const workerId = await setupWorker(repository, REGISTERED_AT, "ONLINE", "ONLINE");

    const now = new Date(REGISTERED_AT.getTime() + STALE_AFTER_MS + 1);
    const workers = await listWorkers({ repository, now: () => now, staleAfterMs: STALE_AFTER_MS });
    const worker = workers.find((w) => w.workerId === workerId);

    expect(worker?.status).toBe("OFFLINE");
    expect(worker?.aeAvailability).toBe("UNAVAILABLE");
    expect(worker?.mcpAvailability).toBe("UNAVAILABLE");

    // The stored row's raw telemetry is untouched - markStaleWorkersOffline
    // must never mutate historical aeStatus/mcpStatus.
    const stored = await repository.findById(workerId);
    expect(stored?.aeStatus).toBe("ONLINE");
    expect(stored?.mcpStatus).toBe("ONLINE");

    // No worker-required action can become enabled from this stale telemetry:
    // every real dispatch precondition (dispatch-job.ts,
    // resolve-execute-frame-dispatch.ts, resolve-render-dispatch.ts,
    // validate-scene-edit-preconditions.ts) and the frontend's own
    // find-dispatchable-worker.ts picker gate on `status === "ONLINE"`
    // first - never on aeStatus/mcpStatus alone - so a stale-but-"last
    // known ONLINE" AE/MCP value can never make this worker eligible.
    expect(worker?.status === "ONLINE").toBe(false);
  });
});
