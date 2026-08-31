import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SCHEMA_VERSION, authSessionResponseSchema, registerWorkerResponseSchema } from "@dyo/schemas";
import { buildApp } from "../app.js";
import { DrizzleJobRepository } from "../infrastructure/db/drizzle-job-repository.js";
import { DrizzleSessionRepository } from "../infrastructure/db/drizzle-session-repository.js";
import { DrizzleUserRepository } from "../infrastructure/db/drizzle-user-repository.js";
import { DrizzleWorkerRepository } from "../infrastructure/db/drizzle-worker-repository.js";
import { DrizzleProjectRepository } from "../infrastructure/db/drizzle-project-repository.js";
import { DrizzleExecutionPlanRepository } from "../infrastructure/db/drizzle-execution-plan-repository.js";
import { DrizzleExecutionSessionRepository } from "../infrastructure/db/drizzle-execution-session-repository.js";
import { DrizzleAssetRepository } from "../infrastructure/db/drizzle-asset-repository.js";
import { DrizzleWorkMapRepository } from "../infrastructure/db/drizzle-work-map-repository.js";
import { DrizzleMappingSuggestionRepository } from "../infrastructure/db/drizzle-mapping-suggestion-repository.js";
import { DrizzleSceneEvidenceRepository } from "../infrastructure/db/drizzle-scene-evidence-repository.js";
import { DrizzleRenderArtifactRepository } from "../infrastructure/db/drizzle-render-artifact-repository.js";
import { DrizzleRenderArtifactUploadRepository } from "../infrastructure/db/drizzle-render-artifact-upload-repository.js";
import { DrizzleFullPreviewArtifactRepository } from "../infrastructure/db/drizzle-full-preview-artifact-repository.js";
import { DrizzleSceneEvidencePreviewRepository } from "../infrastructure/db/drizzle-scene-evidence-preview-repository.js";
import { DrizzleUserAiProviderRepository } from "../infrastructure/db/drizzle-user-ai-provider-repository.js";
import { LocalFilesystemAssetStorage } from "../infrastructure/storage/local-filesystem-asset-storage.js";
import { createTestDatabase } from "./test-database.js";

const REGISTRATION_SECRET = "test-registration-secret-1234567890";
const STALE_AFTER_MS = 30_000;
const SOURCE_SHA = "a".repeat(64);

async function setup() {
  const { db, close } = await createTestDatabase();
  const storageRoot = mkdtempSync(join(tmpdir(), "dyo-test-preview-"));
  const jobRepository = new DrizzleJobRepository(db);
  const executionPlanRepository = new DrizzleExecutionPlanRepository(db);
  const executionSessionRepository = new DrizzleExecutionSessionRepository(db);
  const app: FastifyInstance = await buildApp({
    env: {
      WORKER_REGISTRATION_SECRET: REGISTRATION_SECRET,
      WORKER_HEARTBEAT_STALE_AFTER_MS: STALE_AFTER_MS,
      LOG_LEVEL: "silent" as never,
      ASSET_MAX_UPLOAD_BYTES: 10_000_000,
      RENDER_ARTIFACT_MAX_UPLOAD_BYTES: 2_000_000_000
    },
    workerRepository: new DrizzleWorkerRepository(db),
    jobRepository,
    userRepository: new DrizzleUserRepository(db),
    sessionRepository: new DrizzleSessionRepository(db),
    projectRepository: new DrizzleProjectRepository(db),
    executionPlanRepository,
    executionSessionRepository,
    assetRepository: new DrizzleAssetRepository(db),
    assetStorage: new LocalFilesystemAssetStorage(storageRoot),
    workMapRepository: new DrizzleWorkMapRepository(db),
    mappingSuggestionRepository: new DrizzleMappingSuggestionRepository(db),
    sceneEvidenceRepository: new DrizzleSceneEvidenceRepository(db),
    renderArtifactRepository: new DrizzleRenderArtifactRepository(db),
    renderArtifactUploadRepository: new DrizzleRenderArtifactUploadRepository(db),
    fullPreviewArtifactRepository: new DrizzleFullPreviewArtifactRepository(db),
    sceneEvidencePreviewRepository: new DrizzleSceneEvidencePreviewRepository(db),
    userAiProviderRepository: new DrizzleUserAiProviderRepository(db),
    checkDatabaseHealth: async () => {
      await db.execute("select 1");
      return true;
    }
  });
  return { app, close, jobRepository, executionPlanRepository, executionSessionRepository };
}

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

let harness: Awaited<ReturnType<typeof setup>>;
let sessionToken: string;

beforeEach(async () => {
  harness = await setup();
  sessionToken = await signUpAndGetSessionToken(harness.app);
});

afterAll(async () => {
  await harness?.close();
});

async function createProject(): Promise<string> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: {
      name: "Preview Test Project",
      manifest: {
        schemaVersion: SCHEMA_VERSION,
        templateId: "tmpl-1",
        templateName: "tmpl-1",
        sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: SOURCE_SHA },
        afterEffects: { version: "26.3x87" },
        generatedAt: new Date().toISOString(),
        compositions: [],
        scenes: [],
        preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
        unknownItems: []
      }
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json().projectId as string;
}

async function registerWorker(capabilities: string[] = ["EXECUTE_FRAME"]) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/workers/register",
    headers: { authorization: `Bearer ${REGISTRATION_SECRET}` },
    payload: { name: "Preview Worker", maxConcurrency: 1, capabilities }
  });
  return registerWorkerResponseSchema.parse(response.json());
}

async function createPlan(projectId: string, revision = 1) {
  return harness.executionPlanRepository.createRevision(
    {
      id: randomUUID(),
      projectId,
      revision,
      status: "APPROVED",
      templateId: "tmpl-1",
      sourceProjectSha256: SOURCE_SHA,
      scenePlans: [],
      approvedAt: new Date("2026-01-01T00:00:00.000Z"),
      approvedBy: null
    },
    new Date("2026-01-01T00:00:00.000Z")
  );
}

async function createSession(projectId: string, planId: string, workerId: string, planRevision = 1) {
  return harness.executionSessionRepository.create(
    {
      id: randomUUID(),
      projectId,
      executionPlanId: planId,
      planRevision,
      sourceProjectSha256: SOURCE_SHA,
      assignedWorkerId: workerId
    },
    new Date("2026-01-01T00:00:00.000Z")
  );
}

async function createRunningExecuteFrameJob(workerId: string, projectId: string, executionSessionId: string, expectedWorkingProjectSha256: string | null = null) {
  const job = await harness.jobRepository.create(
    {
      id: randomUUID(),
      workerId,
      projectId,
      operation: "EXECUTE_FRAME",
      payload: {
        projectId,
        planId: "plan-1",
        planRevision: 1,
        sourceProjectSha256: SOURCE_SHA,
        sourceProjectPath: "/copies/test.aep",
        executionSessionId,
        expectedWorkingProjectSha256,
        scenePlanId: "scene-1",
        manifestCompositionId: "comp-1",
        aeProjectItemIndex: 1,
        compositionName: "Master",
        approvedMappingIds: ["mapping-1"],
        operations: [{ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "Hello" }],
        checkpoint: null
      }
    },
    new Date("2026-01-01T00:00:00.000Z")
  );
  return job;
}

async function claimAndReachRunning(workerId: string, workerToken: string, job: { id: string }) {
  await harness.app.inject({ method: "POST", url: `/api/workers/${workerId}/jobs/claim`, headers: { authorization: `Bearer ${workerToken}` } });
  await harness.app.inject({
    method: "POST",
    url: `/api/workers/${workerId}/jobs/${job.id}/report`,
    headers: { authorization: `Bearer ${workerToken}` },
    payload: { status: "RUNNING" }
  });
}

async function uploadPreviewBytes(workerId: string, workerToken: string, jobId: string, bytes: Buffer) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), "preview.png");
  const encoded = new Request("http://upload.local", { method: "POST", body: form });
  const payload = Buffer.from(await encoded.arrayBuffer());
  const contentType = encoded.headers.get("content-type") ?? "";

  return harness.app.inject({
    method: "POST",
    url: `/api/workers/${workerId}/jobs/${jobId}/preview`,
    headers: { authorization: `Bearer ${workerToken}`, "content-type": contentType },
    payload
  });
}

describe("POST /api/workers/:workerId/jobs/:jobId/preview", () => {
  it("requires the worker's bearer token", async () => {
    const projectId = await createProject();
    const plan = await createPlan(projectId);
    const { workerId } = await registerWorker();
    const session = await createSession(projectId, plan.id, workerId);
    const job = await createRunningExecuteFrameJob(workerId, projectId, session.id);

    const response = await harness.app.inject({ method: "POST", url: `/api/workers/${workerId}/jobs/${job.id}/preview` });
    expect(response.statusCode).toBe(401);
  });

  it("returns 409 when the job is not RUNNING (still QUEUED)", async () => {
    const projectId = await createProject();
    const plan = await createPlan(projectId);
    const { workerId, workerToken } = await registerWorker();
    const session = await createSession(projectId, plan.id, workerId);
    const job = await createRunningExecuteFrameJob(workerId, projectId, session.id);

    const response = await uploadPreviewBytes(workerId, workerToken, job.id, Buffer.from("fake-png-bytes"));
    expect(response.statusCode).toBe(409);
  });

  it("returns 201 and records the preview on the session for a real, running EXECUTE_FRAME job", async () => {
    const projectId = await createProject();
    const plan = await createPlan(projectId);
    const { workerId, workerToken } = await registerWorker();
    const session = await createSession(projectId, plan.id, workerId);
    const job = await createRunningExecuteFrameJob(workerId, projectId, session.id);
    await claimAndReachRunning(workerId, workerToken, job);

    const realBytes = Buffer.from("the exact real preview png bytes, byte for byte");
    const response = await uploadPreviewBytes(workerId, workerToken, job.id, realBytes);

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.executionSessionId).toBe(session.id);
    expect(typeof body.sha256).toBe("string");
    expect(body.byteSize).toBe(realBytes.length);

    const updated = await harness.executionSessionRepository.findById(session.id);
    expect(updated?.latestPreviewSha256).toBe(body.sha256);
    expect(updated?.latestPreviewScenePlanId).toBe("scene-1");
  });

  it("replaces a prior preview rather than accumulating - only ever one current preview per session", async () => {
    const projectId = await createProject();
    const plan = await createPlan(projectId);
    const { workerId, workerToken } = await registerWorker();
    const session = await createSession(projectId, plan.id, workerId);

    const firstJob = await createRunningExecuteFrameJob(workerId, projectId, session.id);
    await claimAndReachRunning(workerId, workerToken, firstJob);
    await uploadPreviewBytes(workerId, workerToken, firstJob.id, Buffer.from("first preview bytes"));
    const afterFirst = await harness.executionSessionRepository.findById(session.id);
    const firstStorageKey = afterFirst?.latestPreviewStorageKey;
    expect(firstStorageKey).not.toBeNull();

    await harness.app.inject({
      method: "POST",
      url: `/api/workers/${workerId}/jobs/${firstJob.id}/report`,
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { status: "FAILED", error: { code: "NOT_AVAILABLE", message: "simulated: continuing to a second attempt" } }
    });

    const secondJob = await createRunningExecuteFrameJob(workerId, projectId, session.id, afterFirst?.latestWorkingProjectSha256 ?? null);
    await claimAndReachRunning(workerId, workerToken, secondJob);
    const secondResponse = await uploadPreviewBytes(workerId, workerToken, secondJob.id, Buffer.from("second, replacing preview bytes"));
    expect(secondResponse.statusCode).toBe(201);

    const afterSecond = await harness.executionSessionRepository.findById(session.id);
    expect(afterSecond?.latestPreviewStorageKey).not.toBe(firstStorageKey);
    expect(afterSecond?.latestPreviewSha256).toBe(secondResponse.json().sha256);
  });
});

describe("GET /api/projects/:projectId/execution-sessions/:sessionId/preview", () => {
  it("requires a dashboard session", async () => {
    const projectId = await createProject();
    const plan = await createPlan(projectId);
    const { workerId } = await registerWorker();
    const session = await createSession(projectId, plan.id, workerId);

    const response = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/execution-sessions/${session.id}/preview` });
    expect(response.statusCode).toBe(401);
  });

  it("returns 404 when no preview has been uploaded yet", async () => {
    const projectId = await createProject();
    const plan = await createPlan(projectId);
    const { workerId } = await registerWorker();
    const session = await createSession(projectId, plan.id, workerId);

    const response = await harness.app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/execution-sessions/${session.id}/preview`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for a session belonging to a DIFFERENT project - cross-project fetch refused", async () => {
    const projectId = await createProject();
    const otherProjectId = await createProject();
    const plan = await createPlan(otherProjectId);
    const { workerId } = await registerWorker();
    const session = await createSession(otherProjectId, plan.id, workerId);

    const response = await harness.app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/execution-sessions/${session.id}/preview`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(response.statusCode).toBe(404);
  });

  it("streams the real preview bytes with content-type image/png once uploaded - never a storage key/filesystem path", async () => {
    const projectId = await createProject();
    const plan = await createPlan(projectId);
    const { workerId, workerToken } = await registerWorker();
    const session = await createSession(projectId, plan.id, workerId);
    const job = await createRunningExecuteFrameJob(workerId, projectId, session.id);
    await claimAndReachRunning(workerId, workerToken, job);
    const realBytes = Buffer.from("the exact real preview png bytes, byte for byte");
    await uploadPreviewBytes(workerId, workerToken, job.id, realBytes);

    const response = await harness.app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/execution-sessions/${session.id}/preview`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(response.rawPayload)).toEqual(realBytes);
  });
});

describe("Approve/Reject preview - stale plan revision blocked", () => {
  async function makeAwaitingPreviewSession(projectId: string, planId: string, workerId: string, planRevision = 1) {
    const session = await createSession(projectId, planId, workerId, planRevision);
    // Directly moves the session past PREPARING into AWAITING_PREVIEW_APPROVAL,
    // matching what a real successful EXECUTE_FRAME job report would do -
    // this test only cares about the approve/reject gate itself, not the
    // full scene-completion side effect chain.
    await harness.executionSessionRepository.recordSceneCompleted(session.id, "scene-1", "b".repeat(64), "AWAITING_PREVIEW_APPROVAL", new Date());
    return session;
  }

  it("approves a preview for a session whose bound plan revision is still current", async () => {
    const projectId = await createProject();
    const plan = await createPlan(projectId, 1);
    const { workerId } = await registerWorker();
    const session = await makeAwaitingPreviewSession(projectId, plan.id, workerId, 1);

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/execution-sessions/${session.id}/approve-preview`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().session.firstPreviewApproved).toBe(true);
  });

  it("blocks approval when the plan has changed revision since the session began - never silently approves against a stale/empty required-scene set", async () => {
    const projectId = await createProject();
    const plan = await createPlan(projectId, 1);
    const { workerId } = await registerWorker();
    const session = await makeAwaitingPreviewSession(projectId, plan.id, workerId, 1);
    // A new plan revision lands AFTER the session began.
    await createPlan(projectId, 2);

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/execution-sessions/${session.id}/approve-preview`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain("changed since this session began");

    const unchanged = await harness.executionSessionRepository.findById(session.id);
    expect(unchanged?.firstPreviewApproved).toBe(false);
    expect(unchanged?.status).toBe("AWAITING_PREVIEW_APPROVAL");
  });

  it("rejects a preview, marking the session FAILED (terminal) - never silently continues", async () => {
    const projectId = await createProject();
    const plan = await createPlan(projectId, 1);
    const { workerId } = await registerWorker();
    const session = await makeAwaitingPreviewSession(projectId, plan.id, workerId, 1);

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/execution-sessions/${session.id}/reject-preview`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().session.status).toBe("FAILED");

    // A second reject attempt on the now-terminal session is refused, not a silent no-op.
    const second = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/execution-sessions/${session.id}/reject-preview`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(second.statusCode).toBe(409);
  });

  it("refuses to reject a session that isn't AWAITING_PREVIEW_APPROVAL (still PREPARING)", async () => {
    const projectId = await createProject();
    const plan = await createPlan(projectId, 1);
    const { workerId } = await registerWorker();
    const session = await createSession(projectId, plan.id, workerId, 1);

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/execution-sessions/${session.id}/reject-preview`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(response.statusCode).toBe(409);
  });
});
