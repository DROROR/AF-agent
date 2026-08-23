import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { registerWorkerResponseSchema } from "@dyo/schemas";
import { buildApp } from "../app.js";
import { DrizzleWorkerRepository } from "../infrastructure/db/drizzle-worker-repository.js";
import { createTestDatabase } from "./test-database.js";

const REGISTRATION_SECRET = "test-registration-secret-1234567890";
const STALE_AFTER_MS = 30_000;

/**
 * Real end-to-end coverage: real Fastify app, real (embedded) Postgres via
 * PGlite, real committed migrations, real repository - only the clock is
 * injected, so staleness can be tested deterministically without sleeping.
 */
async function setup(initialNow: Date) {
  const { db, close } = await createTestDatabase();
  let current = initialNow;
  const app: FastifyInstance = buildApp({
    env: {
      WORKER_REGISTRATION_SECRET: REGISTRATION_SECRET,
      WORKER_HEARTBEAT_STALE_AFTER_MS: STALE_AFTER_MS,
      LOG_LEVEL: "silent" as never
    },
    workerRepository: new DrizzleWorkerRepository(db),
    checkDatabaseHealth: async () => {
      await db.execute("select 1");
      return true;
    },
    now: () => current
  });
  return {
    app,
    close,
    advanceTime: (ms: number) => {
      current = new Date(current.getTime() + ms);
    }
  };
}

async function registerWorker(app: FastifyInstance, name = "Client PC 1") {
  const response = await app.inject({
    method: "POST",
    url: "/api/workers/register",
    headers: { authorization: `Bearer ${REGISTRATION_SECRET}` },
    payload: { name, maxConcurrency: 1, capabilities: [] }
  });
  return { response, body: registerWorkerResponseSchema.parse(response.json()) };
}

let harness: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  harness = await setup(new Date("2026-01-01T00:00:00.000Z"));
});

afterAll(async () => {
  await harness?.close();
});

describe("health endpoints", () => {
  it("liveness always reports ok", async () => {
    const response = await harness.app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("readiness reports ok when the database is reachable", async () => {
    const response = await harness.app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", database: "ok" });
  });
});

describe("POST /api/workers/register", () => {
  it("registers a worker given a valid pairing secret", async () => {
    const { response } = await registerWorker(harness.app);
    // registerWorker() already parses the body against registerWorkerResponseSchema -
    // a malformed workerId/workerToken would have thrown before this line.
    expect(response.statusCode).toBe(201);
  });

  it("rejects registration with an invalid pairing secret", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/workers/register",
      headers: { authorization: "Bearer wrong-secret" },
      payload: { name: "Client PC 1" }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects registration with no Authorization header", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/workers/register",
      payload: { name: "Client PC 1" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an invalid payload with a 400 VALIDATION_ERROR", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/workers/register",
      headers: { authorization: `Bearer ${REGISTRATION_SECRET}` },
      payload: { name: "" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("gives each registered worker a distinct ID (multi-worker from day one)", async () => {
    const first = await registerWorker(harness.app, "Worker A");
    const second = await registerWorker(harness.app, "Worker B");
    expect(first.body.workerId).not.toBe(second.body.workerId);
  });
});

describe("POST /api/workers/:workerId/heartbeat", () => {
  it("accepts an authenticated heartbeat and marks the worker ONLINE", async () => {
    const { body } = await registerWorker(harness.app);

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/workers/${body.workerId}/heartbeat`,
      headers: { authorization: `Bearer ${body.workerToken}` },
      payload: { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0" }
    });

    expect(response.statusCode).toBe(200);
    const dto = response.json();
    expect(dto.status).toBe("ONLINE");
    expect(dto.aeStatus).toBe("ONLINE");
  });

  it("rejects a heartbeat with the wrong token", async () => {
    const { body } = await registerWorker(harness.app);

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/workers/${body.workerId}/heartbeat`,
      headers: { authorization: "Bearer wrong-token" },
      payload: { aeStatus: "ONLINE", mcpStatus: "ONLINE" }
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects an invalid aeStatus value with 400", async () => {
    const { body } = await registerWorker(harness.app);

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/workers/${body.workerId}/heartbeat`,
      headers: { authorization: `Bearer ${body.workerToken}` },
      payload: { aeStatus: "NOT_A_REAL_STATUS", mcpStatus: "ONLINE" }
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/workers and /api/workers/:workerId", () => {
  it("lists a registered worker after heartbeat", async () => {
    const { body } = await registerWorker(harness.app);
    await harness.app.inject({
      method: "POST",
      url: `/api/workers/${body.workerId}/heartbeat`,
      headers: { authorization: `Bearer ${body.workerToken}` },
      payload: { aeStatus: "ONLINE", mcpStatus: "ONLINE" }
    });

    const response = await harness.app.inject({ method: "GET", url: "/api/workers" });
    const listed = response.json().workers;
    expect(listed).toHaveLength(1);
    expect(listed[0].workerId).toBe(body.workerId);
    expect(listed[0].status).toBe("ONLINE");
  });

  it("returns 404 for an unknown worker", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/workers/00000000-0000-0000-0000-000000000000"
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("WORKER_NOT_FOUND");
  });

  it("flips a worker to OFFLINE once its heartbeat exceeds the stale window", async () => {
    const { body } = await registerWorker(harness.app);
    await harness.app.inject({
      method: "POST",
      url: `/api/workers/${body.workerId}/heartbeat`,
      headers: { authorization: `Bearer ${body.workerToken}` },
      payload: { aeStatus: "ONLINE", mcpStatus: "ONLINE" }
    });

    harness.advanceTime(STALE_AFTER_MS + 1_000);

    const response = await harness.app.inject({
      method: "GET",
      url: `/api/workers/${body.workerId}`
    });
    expect(response.json().status).toBe("OFFLINE");
  });
});
