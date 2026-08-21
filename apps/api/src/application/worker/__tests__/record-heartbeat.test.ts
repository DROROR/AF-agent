import { describe, expect, it } from "vitest";
import { generateWorkerToken, hashToken, verifyToken } from "../../../infrastructure/auth/token.js";
import { UnauthorizedError } from "../../../errors/app-error.js";
import { InMemoryWorkerRepository } from "../test-support/in-memory-worker-repository.js";
import { registerWorker } from "../register-worker.js";
import { recordHeartbeat } from "../record-heartbeat.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

async function setupRegisteredWorker(repository: InMemoryWorkerRepository) {
  return registerWorker(
    { repository, generateToken: generateWorkerToken, hashToken, now: () => FIXED_NOW },
    { name: "Client PC 1", maxConcurrency: 1, capabilities: [] }
  );
}

describe("recordHeartbeat", () => {
  it("marks a registered worker ONLINE and stores reported AE/MCP status", async () => {
    const repository = new InMemoryWorkerRepository();
    const { workerId, workerToken } = await setupRegisteredWorker(repository);

    const dto = await recordHeartbeat(
      { repository, verifyToken, now: () => FIXED_NOW },
      workerId,
      workerToken,
      { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: null }
    );

    expect(dto.status).toBe("ONLINE");
    expect(dto.aeStatus).toBe("ONLINE");
    expect(dto.aeVersion).toBe("26.0");
    expect(dto.lastHeartbeatAt).toBe(FIXED_NOW.toISOString());
  });

  it("rejects a heartbeat with the wrong token", async () => {
    const repository = new InMemoryWorkerRepository();
    const { workerId } = await setupRegisteredWorker(repository);

    await expect(
      recordHeartbeat(
        { repository, verifyToken, now: () => FIXED_NOW },
        workerId,
        "not-the-real-token",
        { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: null, currentJobId: null }
      )
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a heartbeat for a worker ID that does not exist", async () => {
    const repository = new InMemoryWorkerRepository();

    await expect(
      recordHeartbeat(
        { repository, verifyToken, now: () => FIXED_NOW },
        "00000000-0000-0000-0000-000000000000",
        "any-token",
        { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: null, currentJobId: null }
      )
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("propagates currentJobId so the worker's active job is visible", async () => {
    const repository = new InMemoryWorkerRepository();
    const { workerId, workerToken } = await setupRegisteredWorker(repository);
    const jobId = "11111111-1111-1111-1111-111111111111";

    const dto = await recordHeartbeat(
      { repository, verifyToken, now: () => FIXED_NOW },
      workerId,
      workerToken,
      { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: null, currentJobId: jobId }
    );

    expect(dto.currentJobId).toBe(jobId);
  });
});
