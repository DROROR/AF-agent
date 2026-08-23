import { registerWorkerResponseSchema } from "@dyo/schemas";
import { describe, expect, it } from "vitest";
import { generateWorkerToken, hashToken, verifyToken } from "../../../infrastructure/auth/token.js";
import { InMemoryWorkerRepository } from "../test-support/in-memory-worker-repository.js";
import { registerWorker } from "../register-worker.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

describe("registerWorker", () => {
  it("creates a worker with a unique ID and returns a usable token", async () => {
    const repository = new InMemoryWorkerRepository();

    const result = await registerWorker(
      { repository, generateToken: generateWorkerToken, hashToken, now: () => FIXED_NOW },
      { name: "Client PC 1", maxConcurrency: 1, capabilities: [] }
    );

    expect(registerWorkerResponseSchema.safeParse(result).success).toBe(true);

    const stored = await repository.findById(result.workerId);
    expect(stored).not.toBeNull();
    expect(stored?.tokenHash).not.toContain(result.workerToken);
    await expect(verifyToken(result.workerToken, stored?.tokenHash ?? "")).resolves.toBe(true);
  });

  it("assigns a different ID to each registered worker (multi-worker support)", async () => {
    const repository = new InMemoryWorkerRepository();
    const deps = { repository, generateToken: generateWorkerToken, hashToken, now: () => FIXED_NOW };

    const first = await registerWorker(deps, { name: "Worker A", maxConcurrency: 1, capabilities: [] });
    const second = await registerWorker(deps, { name: "Worker B", maxConcurrency: 2, capabilities: [] });

    expect(first.workerId).not.toBe(second.workerId);
    const all = await repository.findAll();
    expect(all).toHaveLength(2);
  });

  it("starts a newly registered worker as OFFLINE until its first heartbeat", async () => {
    const repository = new InMemoryWorkerRepository();
    const result = await registerWorker(
      { repository, generateToken: generateWorkerToken, hashToken, now: () => FIXED_NOW },
      { name: "Client PC 1", maxConcurrency: 1, capabilities: [] }
    );
    const stored = await repository.findById(result.workerId);
    expect(stored?.status).toBe("OFFLINE");
    expect(stored?.lastHeartbeatAt).toBeNull();
  });
});
