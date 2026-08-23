import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { registerWorkerResponseSchema } from "@dyo/schemas";
import { buildApp } from "../app.js";
import { DrizzleJobRepository } from "../infrastructure/db/drizzle-job-repository.js";
import { DrizzleWorkerRepository } from "../infrastructure/db/drizzle-worker-repository.js";
import { createTestDatabase } from "./test-database.js";

const REGISTRATION_SECRET = "test-registration-secret-1234567890";
const STALE_AFTER_MS = 30_000;

/**
 * Real end-to-end coverage for job dispatch: real Fastify app, real
 * (embedded) Postgres via PGlite, real committed migrations, real
 * DrizzleJobRepository - proves the raw SQL (transaction, FOR UPDATE SKIP
 * LOCKED, compare-and-swap update) actually runs against a real
 * Postgres-compatible engine, not just an in-memory fake. See
 * workers.integration.test.ts for the same pattern applied to workers.
 */
async function setup(initialNow: Date) {
  const { db, close } = await createTestDatabase();
  let current = initialNow;
  const jobRepository = new DrizzleJobRepository(db);
  const app: FastifyInstance = buildApp({
    env: {
      WORKER_REGISTRATION_SECRET: REGISTRATION_SECRET,
      WORKER_HEARTBEAT_STALE_AFTER_MS: STALE_AFTER_MS,
      LOG_LEVEL: "silent" as never
    },
    workerRepository: new DrizzleWorkerRepository(db),
    jobRepository,
    checkDatabaseHealth: async () => {
      await db.execute("select 1");
      return true;
    },
    now: () => current
  });
  return {
    app,
    db,
    jobRepository,
    close,
    advanceTime: (ms: number) => {
      current = new Date(current.getTime() + ms);
    }
  };
}

async function registerAndHeartbeatWorker(app: FastifyInstance, maxConcurrency = 1) {
  const registerResponse = await app.inject({
    method: "POST",
    url: "/api/workers/register",
    headers: { authorization: `Bearer ${REGISTRATION_SECRET}` },
    payload: { name: "Client PC 1", maxConcurrency, capabilities: ["INSPECT_TEMPLATE"] }
  });
  const { workerId, workerToken } = registerWorkerResponseSchema.parse(registerResponse.json());

  // A worker must have a real heartbeat on record before it can claim jobs
  // (sweepStaleJobs otherwise treats a never-heartbeated worker as offline) -
  // see apps/api/src/application/job/__tests__/claim-next-job.test.ts for
  // the same requirement at the unit level.
  await app.inject({
    method: "POST",
    url: `/api/workers/${workerId}/heartbeat`,
    headers: { authorization: `Bearer ${workerToken}` },
    payload: { aeStatus: "ONLINE", mcpStatus: "ONLINE" }
  });

  return { workerId, workerToken };
}

let harness: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  harness = await setup(new Date("2026-01-01T00:00:00.000Z"));
});

afterAll(async () => {
  await harness?.close();
});

describe("POST /api/workers/:workerId/jobs/claim", () => {
  it("requires the worker's bearer token", async () => {
    const { workerId } = await registerAndHeartbeatWorker(harness.app);
    const response = await harness.app.inject({ method: "POST", url: `/api/workers/${workerId}/jobs/claim` });
    expect(response.statusCode).toBe(401);
  });

  it("returns job: null when there is nothing queued", async () => {
    const { workerId, workerToken } = await registerAndHeartbeatWorker(harness.app);
    const response = await harness.app.inject({
      method: "POST",
      url: `/api/workers/${workerId}/jobs/claim`,
      headers: { authorization: `Bearer ${workerToken}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().job).toBeNull();
  });

  it("claims a real queued job via the real transaction/locking SQL and marks it CLAIMED", async () => {
    const { workerId, workerToken } = await registerAndHeartbeatWorker(harness.app);
    const created = await harness.jobRepository.create(
      { id: randomUUID(), workerId, operation: "INSPECT_TEMPLATE", payload: { templateId: "t", sourceProjectPath: "/x.aep" } },
      new Date("2026-01-01T00:00:00.000Z")
    );

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/workers/${workerId}/jobs/claim`,
      headers: { authorization: `Bearer ${workerToken}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.job.jobId).toBe(created.id);
    expect(body.job.status).toBe("CLAIMED");
  });

  it("does not let a second claim take the same job (no duplicate claim)", async () => {
    const { workerId, workerToken } = await registerAndHeartbeatWorker(harness.app);
    await harness.jobRepository.create(
      { id: randomUUID(), workerId, operation: "INSPECT_TEMPLATE", payload: { templateId: "t", sourceProjectPath: "/x.aep" } },
      new Date("2026-01-01T00:00:00.000Z")
    );

    const claimOnce = () =>
      harness.app.inject({
        method: "POST",
        url: `/api/workers/${workerId}/jobs/claim`,
        headers: { authorization: `Bearer ${workerToken}` }
      });

    const first = await claimOnce();
    const second = await claimOnce();

    expect(first.json().job).not.toBeNull();
    expect(second.json().job).toBeNull();
  });

  it("a worker with maxConcurrency=1 cannot claim a second job while one is already active", async () => {
    const { workerId, workerToken } = await registerAndHeartbeatWorker(harness.app, 1);
    await harness.jobRepository.create(
      { id: randomUUID(), workerId, operation: "INSPECT_TEMPLATE", payload: { templateId: "t", sourceProjectPath: "/x.aep" } },
      new Date("2026-01-01T00:00:00.000Z")
    );
    await harness.jobRepository.create(
      { id: randomUUID(), workerId, operation: "INSPECT_TEMPLATE", payload: { templateId: "t2", sourceProjectPath: "/y.aep" } },
      new Date("2026-01-01T00:00:00.000Z")
    );

    const claimOnce = () =>
      harness.app.inject({
        method: "POST",
        url: `/api/workers/${workerId}/jobs/claim`,
        headers: { authorization: `Bearer ${workerToken}` }
      });

    const first = await claimOnce();
    const second = await claimOnce();

    expect(first.json().job).not.toBeNull();
    expect(second.json().job).toBeNull();
  });
});

describe("POST /api/workers/:workerId/jobs/:jobId/report", () => {
  it("requires the worker's bearer token", async () => {
    const { workerId } = await registerAndHeartbeatWorker(harness.app);
    const response = await harness.app.inject({
      method: "POST",
      url: `/api/workers/${workerId}/jobs/${randomUUID()}/report`,
      payload: { status: "RUNNING" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("returns 404 for a job that belongs to a different worker", async () => {
    const { workerId: ownerId } = await registerAndHeartbeatWorker(harness.app);
    const { workerId: otherWorkerId, workerToken: otherToken } = await registerAndHeartbeatWorker(harness.app);
    const job = await harness.jobRepository.create(
      { id: randomUUID(), workerId: ownerId, operation: "INSPECT_TEMPLATE", payload: { templateId: "t", sourceProjectPath: "/x.aep" } },
      new Date("2026-01-01T00:00:00.000Z")
    );

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/workers/${otherWorkerId}/jobs/${job.id}/report`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { status: "RUNNING" }
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects an invalid state transition with 409", async () => {
    const { workerId, workerToken } = await registerAndHeartbeatWorker(harness.app);
    const job = await harness.jobRepository.create(
      { id: randomUUID(), workerId, operation: "INSPECT_TEMPLATE", payload: { templateId: "t", sourceProjectPath: "/x.aep" } },
      new Date("2026-01-01T00:00:00.000Z")
    );

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/workers/${workerId}/jobs/${job.id}/report`,
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { status: "SUCCEEDED" } // job is still QUEUED, not even claimed
    });
    expect(response.statusCode).toBe(409);
  });

  it("runs a full real claim -> RUNNING -> SUCCEEDED cycle over HTTP", async () => {
    const { workerId, workerToken } = await registerAndHeartbeatWorker(harness.app);
    const job = await harness.jobRepository.create(
      { id: randomUUID(), workerId, operation: "INSPECT_TEMPLATE", payload: { templateId: "t", sourceProjectPath: "/x.aep" } },
      new Date("2026-01-01T00:00:00.000Z")
    );

    await harness.app.inject({
      method: "POST",
      url: `/api/workers/${workerId}/jobs/claim`,
      headers: { authorization: `Bearer ${workerToken}` }
    });

    const runningResponse = await harness.app.inject({
      method: "POST",
      url: `/api/workers/${workerId}/jobs/${job.id}/report`,
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { status: "RUNNING" }
    });
    expect(runningResponse.statusCode).toBe(200);
    expect(runningResponse.json().status).toBe("RUNNING");

    const succeededResponse = await harness.app.inject({
      method: "POST",
      url: `/api/workers/${workerId}/jobs/${job.id}/report`,
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { status: "SUCCEEDED", result: { manifestReady: true } }
    });
    expect(succeededResponse.statusCode).toBe(200);
    const body = succeededResponse.json();
    expect(body.status).toBe("SUCCEEDED");
    expect(body.result).toEqual({ manifestReady: true });
    expect(body.completedAt).not.toBeNull();
  });

  it("a completed job cannot be reclaimed or reported again (restart-safe: state lives in the database, not in-process)", async () => {
    const { workerId, workerToken } = await registerAndHeartbeatWorker(harness.app);
    const job = await harness.jobRepository.create(
      { id: randomUUID(), workerId, operation: "INSPECT_TEMPLATE", payload: { templateId: "t", sourceProjectPath: "/x.aep" } },
      new Date("2026-01-01T00:00:00.000Z")
    );
    await harness.jobRepository.claimNextForWorker(workerId, 1, new Date("2026-01-01T00:00:00.000Z"));
    await harness.jobRepository.updateStatus(
      job.id,
      workerId,
      { expectedCurrentStatus: "CLAIMED", status: "RUNNING" },
      new Date("2026-01-01T00:00:00.000Z")
    );
    await harness.jobRepository.updateStatus(
      job.id,
      workerId,
      { expectedCurrentStatus: "RUNNING", status: "SUCCEEDED", result: { ok: true } },
      new Date("2026-01-01T00:00:00.000Z")
    );

    // A brand-new repository instance against the SAME underlying database
    // connection - simulates the API process restarting. If job state lived
    // only in-process, this fresh instance would see nothing; it must read
    // the real persisted row instead.
    const freshRepository = new DrizzleJobRepository(harness.db);
    const persisted = await freshRepository.findById(job.id);
    expect(persisted?.status).toBe("SUCCEEDED");
    expect(persisted?.result).toEqual({ ok: true });

    const reportResponse = await harness.app.inject({
      method: "POST",
      url: `/api/workers/${workerId}/jobs/${job.id}/report`,
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { status: "RUNNING" }
    });
    expect(reportResponse.statusCode).toBe(409);
  });
});
