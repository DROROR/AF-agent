import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authSessionResponseSchema, registerWorkerResponseSchema } from "@dyo/schemas";
import { buildApp } from "../app.js";
import { DrizzleJobRepository } from "../infrastructure/db/drizzle-job-repository.js";
import { DrizzleSessionRepository } from "../infrastructure/db/drizzle-session-repository.js";
import { DrizzleUserRepository } from "../infrastructure/db/drizzle-user-repository.js";
import { DrizzleWorkerRepository } from "../infrastructure/db/drizzle-worker-repository.js";
import { DrizzleProjectRepository } from "../infrastructure/db/drizzle-project-repository.js";
import { DrizzleExecutionPlanRepository } from "../infrastructure/db/drizzle-execution-plan-repository.js";
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
  const app: FastifyInstance = await buildApp({
    env: {
      WORKER_REGISTRATION_SECRET: REGISTRATION_SECRET,
      WORKER_HEARTBEAT_STALE_AFTER_MS: STALE_AFTER_MS,
      LOG_LEVEL: "silent" as never
    },
    workerRepository: new DrizzleWorkerRepository(db),
    jobRepository,
    userRepository: new DrizzleUserRepository(db),
    sessionRepository: new DrizzleSessionRepository(db),
    projectRepository: new DrizzleProjectRepository(db),
    executionPlanRepository: new DrizzleExecutionPlanRepository(db),
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

/** POST /api/jobs requires a dashboard session - see routes/jobs.ts. */
async function signUpAndGetSessionToken(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/signup",
    payload: {
      name: "Test Operator",
      email: `operator-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct-horse",
      confirmPassword: "correct-horse"
    }
  });
  return authSessionResponseSchema.parse(response.json()).sessionToken;
}

interface HeartbeatOverrides {
  aeStatus?: "ONLINE" | "OFFLINE" | "UNKNOWN";
  mcpStatus?: "ONLINE" | "OFFLINE" | "UNKNOWN";
  capabilities?: string[];
}

/** Registers a worker and sends one heartbeat with the given (or fully healthy default) status. */
async function registerHealthyWorker(app: FastifyInstance, overrides: HeartbeatOverrides = {}) {
  const registerResponse = await app.inject({
    method: "POST",
    url: "/api/workers/register",
    headers: { authorization: `Bearer ${REGISTRATION_SECRET}` },
    payload: { name: "Client PC 1", maxConcurrency: 1, capabilities: overrides.capabilities ?? ["INSPECT_TEMPLATE"] }
  });
  const { workerId, workerToken } = registerWorkerResponseSchema.parse(registerResponse.json());

  await app.inject({
    method: "POST",
    url: `/api/workers/${workerId}/heartbeat`,
    headers: { authorization: `Bearer ${workerToken}` },
    payload: {
      aeStatus: overrides.aeStatus ?? "ONLINE",
      mcpStatus: overrides.mcpStatus ?? "ONLINE",
      aeVersion: "26.0",
      capabilities: overrides.capabilities ?? ["INSPECT_TEMPLATE"]
    }
  });

  return { workerId, workerToken };
}

let harness: Awaited<ReturnType<typeof setup>>;
let sessionToken: string;

beforeEach(async () => {
  harness = await setup(new Date("2026-01-01T00:00:00.000Z"));
  sessionToken = await signUpAndGetSessionToken(harness.app);
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

describe("POST /api/jobs (dispatch)", () => {
  const validPayload = { templateId: "t1", sourceProjectPath: "/copies/t1.aep" };

  function dispatch(body: Record<string, unknown>, token = sessionToken) {
    return harness.app.inject({
      method: "POST",
      url: "/api/jobs",
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      payload: body
    });
  }

  it("rejects an unauthenticated request", async () => {
    const { workerId } = await registerHealthyWorker(harness.app);
    // "" (not undefined) - dispatch()'s default parameter only kicks in for
    // an omitted/undefined argument, so this deliberately sends no
    // Authorization header rather than falling back to sessionToken.
    const response = await dispatch({ operation: "INSPECT_TEMPLATE", workerId, payload: validPayload }, "");
    expect(response.statusCode).toBe(401);
  });

  it("rejects a malformed request body", async () => {
    const response = await dispatch({ operation: "INSPECT_TEMPLATE" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unsupported operation", async () => {
    const { workerId } = await registerHealthyWorker(harness.app);
    const response = await dispatch({ operation: "RENDER", workerId, payload: validPayload });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a nonexistent worker", async () => {
    const response = await dispatch({ operation: "INSPECT_TEMPLATE", workerId: randomUUID(), payload: validPayload });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("WORKER_NOT_FOUND");
  });

  it("rejects a worker whose heartbeat has gone stale, even though its last known status was ONLINE", async () => {
    const { workerId } = await registerHealthyWorker(harness.app);
    harness.advanceTime(STALE_AFTER_MS + 1_000);

    const response = await dispatch({ operation: "INSPECT_TEMPLATE", workerId, payload: validPayload });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("WORKER_OFFLINE");
  });

  it("rejects when AE is not ONLINE", async () => {
    const { workerId } = await registerHealthyWorker(harness.app, { aeStatus: "OFFLINE" });
    const response = await dispatch({ operation: "INSPECT_TEMPLATE", workerId, payload: validPayload });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PRECONDITION_NOT_MET");
  });

  it("rejects when MCP is not ONLINE", async () => {
    const { workerId } = await registerHealthyWorker(harness.app, { mcpStatus: "OFFLINE" });
    const response = await dispatch({ operation: "INSPECT_TEMPLATE", workerId, payload: validPayload });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PRECONDITION_NOT_MET");
  });

  it("rejects a worker that does not report the INSPECT_TEMPLATE capability", async () => {
    const { workerId } = await registerHealthyWorker(harness.app, { capabilities: ["CHECK_HEALTH"] });
    const response = await dispatch({ operation: "INSPECT_TEMPLATE", workerId, payload: validPayload });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PRECONDITION_NOT_MET");
  });

  it("rejects a busy worker (already has a live job of the same operation claimed)", async () => {
    const { workerId, workerToken } = await registerHealthyWorker(harness.app);
    await harness.jobRepository.create(
      { id: randomUUID(), workerId, operation: "INSPECT_TEMPLATE", payload: validPayload },
      new Date("2026-01-01T00:00:00.000Z")
    );
    await harness.app.inject({
      method: "POST",
      url: `/api/workers/${workerId}/jobs/claim`,
      headers: { authorization: `Bearer ${workerToken}` }
    });

    const response = await dispatch({
      operation: "INSPECT_TEMPLATE",
      workerId,
      payload: { templateId: "t2", sourceProjectPath: "/copies/t2.aep" }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("WORKER_BUSY");
  });

  it("rejects via the currentJobId/concurrency gate even when the in-flight job is a different operation", async () => {
    const { workerId, workerToken } = await registerHealthyWorker(harness.app);
    const otherJob = await harness.jobRepository.create(
      { id: randomUUID(), workerId, operation: "CHECK_HEALTH", payload: {} },
      new Date("2026-01-01T00:00:00.000Z")
    );
    // Worker self-reports its current job via heartbeat, same as a real worker would.
    await harness.app.inject({
      method: "POST",
      url: `/api/workers/${workerId}/heartbeat`,
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { aeStatus: "ONLINE", mcpStatus: "ONLINE", currentJobId: otherJob.id }
    });

    const response = await dispatch({ operation: "INSPECT_TEMPLATE", workerId, payload: validPayload });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("WORKER_BUSY");
  });

  it("creates exactly one QUEUED job for a fresh, fully healthy worker, and never returns a secret", async () => {
    const { workerId } = await registerHealthyWorker(harness.app);
    const response = await dispatch({ operation: "INSPECT_TEMPLATE", workerId, payload: validPayload });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("QUEUED");
    expect(body.workerId).toBe(workerId);
    expect(body.operation).toBe("INSPECT_TEMPLATE");
    expect(JSON.stringify(body)).not.toMatch(/token/i);

    const persisted = await harness.jobRepository.findById(body.jobId);
    expect(persisted?.status).toBe("QUEUED");
  });

  it("rejects a duplicate live INSPECT_TEMPLATE dispatch for the same worker (double-submit protection)", async () => {
    const { workerId } = await registerHealthyWorker(harness.app);

    const first = await dispatch({ operation: "INSPECT_TEMPLATE", workerId, payload: validPayload });
    expect(first.statusCode).toBe(201);

    const second = await dispatch({ operation: "INSPECT_TEMPLATE", workerId, payload: validPayload });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("WORKER_BUSY");
  });
});

describe("POST /api/jobs (dispatch) - CHECK_HEALTH", () => {
  function dispatch(body: Record<string, unknown>, token = sessionToken) {
    return harness.app.inject({
      method: "POST",
      url: "/api/jobs",
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      payload: body
    });
  }

  it("rejects an unauthenticated CHECK_HEALTH request", async () => {
    const { workerId } = await registerHealthyWorker(harness.app, { capabilities: ["CHECK_HEALTH"] });
    const response = await dispatch({ operation: "CHECK_HEALTH", workerId, payload: {} }, "");
    expect(response.statusCode).toBe(401);
  });

  it("accepts a well-formed CHECK_HEALTH dispatch and creates exactly one QUEUED job", async () => {
    const { workerId } = await registerHealthyWorker(harness.app, { capabilities: ["CHECK_HEALTH"] });
    const response = await dispatch({ operation: "CHECK_HEALTH", workerId, payload: {} });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("QUEUED");
    expect(body.operation).toBe("CHECK_HEALTH");

    const persisted = await harness.jobRepository.findById(body.jobId);
    expect(persisted?.status).toBe("QUEUED");
    expect(persisted?.operation).toBe("CHECK_HEALTH");
  });

  it("rejects an arbitrary/unsupported operation", async () => {
    const { workerId } = await registerHealthyWorker(harness.app, { capabilities: ["CHECK_HEALTH"] });
    const response = await dispatch({ operation: "RUN_ANYTHING", workerId, payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a CHECK_HEALTH payload with an extra/arbitrary field (e.g. a command string) - never a generic command endpoint", async () => {
    const { workerId } = await registerHealthyWorker(harness.app, { capabilities: ["CHECK_HEALTH"] });
    const response = await dispatch({ operation: "CHECK_HEALTH", workerId, payload: { cmd: "rm -rf /" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("dispatches CHECK_HEALTH even when the worker reports mcpStatus OFFLINE - diagnosing that is the whole point", async () => {
    const { workerId } = await registerHealthyWorker(harness.app, {
      capabilities: ["CHECK_HEALTH"],
      mcpStatus: "OFFLINE"
    });
    const response = await dispatch({ operation: "CHECK_HEALTH", workerId, payload: {} });
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe("QUEUED");
  });

  it("dispatches CHECK_HEALTH even when the worker reports aeStatus OFFLINE too", async () => {
    const { workerId } = await registerHealthyWorker(harness.app, {
      capabilities: ["CHECK_HEALTH"],
      aeStatus: "OFFLINE",
      mcpStatus: "OFFLINE"
    });
    const response = await dispatch({ operation: "CHECK_HEALTH", workerId, payload: {} });
    expect(response.statusCode).toBe(201);
  });

  it("still rejects a stale/offline worker for CHECK_HEALTH (worker ONLINE is still required)", async () => {
    const { workerId } = await registerHealthyWorker(harness.app, { capabilities: ["CHECK_HEALTH"] });
    harness.advanceTime(STALE_AFTER_MS + 1_000);
    const response = await dispatch({ operation: "CHECK_HEALTH", workerId, payload: {} });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("WORKER_OFFLINE");
  });

  it("still rejects a worker that does not report the CHECK_HEALTH capability", async () => {
    const { workerId } = await registerHealthyWorker(harness.app, { capabilities: ["INSPECT_TEMPLATE"] });
    const response = await dispatch({ operation: "CHECK_HEALTH", workerId, payload: {} });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PRECONDITION_NOT_MET");
  });
});
