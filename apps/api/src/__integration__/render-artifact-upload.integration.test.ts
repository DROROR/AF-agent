import { randomUUID } from "node:crypto";
import { readdirSync, mkdtempSync } from "node:fs";
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
import { NotConfiguredAiSuggestionProvider } from "../application/mapping-assistant/ai-suggestion-provider.js";
import { LocalFilesystemAssetStorage } from "../infrastructure/storage/local-filesystem-asset-storage.js";
import { createTestDatabase } from "./test-database.js";

const REGISTRATION_SECRET = "test-registration-secret-1234567890";
const STALE_AFTER_MS = 30_000;
const RENDER_MAX_UPLOAD_BYTES = 1000; // deliberately small for the size-limit test below

async function setup() {
  const { db, close } = await createTestDatabase();
  const storageRoot = mkdtempSync(join(tmpdir(), "dyo-test-render-artifacts-"));
  const jobRepository = new DrizzleJobRepository(db);
  const renderArtifactUploadRepository = new DrizzleRenderArtifactUploadRepository(db);
  const app: FastifyInstance = await buildApp({
    env: {
      WORKER_REGISTRATION_SECRET: REGISTRATION_SECRET,
      WORKER_HEARTBEAT_STALE_AFTER_MS: STALE_AFTER_MS,
      LOG_LEVEL: "silent" as never,
      ASSET_MAX_UPLOAD_BYTES: 10_000_000,
      RENDER_ARTIFACT_MAX_UPLOAD_BYTES: RENDER_MAX_UPLOAD_BYTES
    },
    workerRepository: new DrizzleWorkerRepository(db),
    jobRepository,
    userRepository: new DrizzleUserRepository(db),
    sessionRepository: new DrizzleSessionRepository(db),
    projectRepository: new DrizzleProjectRepository(db),
    executionPlanRepository: new DrizzleExecutionPlanRepository(db),
    executionSessionRepository: new DrizzleExecutionSessionRepository(db),
    assetRepository: new DrizzleAssetRepository(db),
    assetStorage: new LocalFilesystemAssetStorage(storageRoot),
    workMapRepository: new DrizzleWorkMapRepository(db),
    mappingSuggestionRepository: new DrizzleMappingSuggestionRepository(db),
    sceneEvidenceRepository: new DrizzleSceneEvidenceRepository(db),
    renderArtifactRepository: new DrizzleRenderArtifactRepository(db),
    renderArtifactUploadRepository,
    aiSuggestionProvider: new NotConfiguredAiSuggestionProvider(),
    checkDatabaseHealth: async () => {
      await db.execute("select 1");
      return true;
    }
  });
  return { app, close, jobRepository, renderArtifactUploadRepository, storageRoot };
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
      name: "Upload Test Project",
      manifest: {
        schemaVersion: SCHEMA_VERSION,
        templateId: "tmpl-1",
        templateName: "tmpl-1",
        sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "a".repeat(64) },
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

async function registerWorker(capabilities: string[] = ["RENDER"]) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/workers/register",
    headers: { authorization: `Bearer ${REGISTRATION_SECRET}` },
    payload: { name: "Render Worker", maxConcurrency: 1, capabilities }
  });
  return registerWorkerResponseSchema.parse(response.json());
}

async function createRunningRenderJob(workerId: string, projectId: string, variant = "LANDSCAPE") {
  const job = await harness.jobRepository.create(
    {
      id: randomUUID(),
      workerId,
      projectId,
      operation: "RENDER",
      payload: {
        projectId,
        planId: "plan-1",
        planRevision: 1,
        variant,
        sourceProjectPath: "/copies/test.aep",
        sourceProjectSha256: "a".repeat(64),
        executionSessionId: randomUUID(),
        expectedWorkingProjectSha256: "b".repeat(64),
        aeProjectItemIndex: 1,
        compositionName: "Master",
        renderSettingsTemplateName: "Best Settings",
        outputModuleTemplateName: "H.264 - Match Source",
        checkpoint: null
      }
    },
    new Date("2026-01-01T00:00:00.000Z")
  );
  return job;
}

async function claim(workerId: string, workerToken: string) {
  await harness.app.inject({
    method: "POST",
    url: `/api/workers/${workerId}/jobs/claim`,
    headers: { authorization: `Bearer ${workerToken}` }
  });
}

async function report(workerId: string, workerToken: string, jobId: string, body: Record<string, unknown>) {
  return harness.app.inject({
    method: "POST",
    url: `/api/workers/${workerId}/jobs/${jobId}/report`,
    headers: { authorization: `Bearer ${workerToken}` },
    payload: body
  });
}

async function uploadRaw(workerId: string, workerToken: string | null, jobId: string, variant: string, bytes: Buffer, mimeType = "video/mp4") {
  const form = new FormData();
  form.append("variant", variant);
  form.append("file", new Blob([bytes], { type: mimeType }), "output.mp4");
  const encoded = new Request("http://upload.local", { method: "POST", body: form });
  const payload = Buffer.from(await encoded.arrayBuffer());
  const contentType = encoded.headers.get("content-type") ?? "";

  return harness.app.inject({
    method: "POST",
    url: `/api/workers/${workerId}/jobs/${jobId}/artifact`,
    headers: {
      ...(workerToken ? { authorization: `Bearer ${workerToken}` } : {}),
      "content-type": contentType
    },
    payload
  });
}

describe("POST /api/workers/:workerId/jobs/:jobId/artifact", () => {
  it("requires the worker's bearer token", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningRenderJob(workerId, projectId);
    await claim(workerId, workerToken);
    await report(workerId, workerToken, job.id, { status: "RUNNING" });

    const response = await uploadRaw(workerId, null, job.id, "LANDSCAPE", Buffer.from("bytes"));
    expect(response.statusCode).toBe(401);
  });

  it("returns 404 when the job belongs to a different worker (never distinguishable from not-found)", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningRenderJob(workerId, projectId);
    await claim(workerId, workerToken);
    await report(workerId, workerToken, job.id, { status: "RUNNING" });

    const { workerId: otherWorkerId, workerToken: otherToken } = await registerWorker();
    const response = await uploadRaw(otherWorkerId, otherToken, job.id, "LANDSCAPE", Buffer.from("bytes"));
    expect(response.statusCode).toBe(404);
  });

  it("rejects an upload while the job is still only CLAIMED (not yet RUNNING)", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningRenderJob(workerId, projectId);
    await claim(workerId, workerToken);
    // Deliberately never reported RUNNING.

    const response = await uploadRaw(workerId, workerToken, job.id, "LANDSCAPE", Buffer.from("bytes"));
    expect(response.statusCode).toBe(409);
  });

  it("rejects an upload for a job whose operation is not RENDER", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker(["INSPECT_TEMPLATE"]);
    const job = await harness.jobRepository.create(
      { id: randomUUID(), workerId, projectId, operation: "INSPECT_TEMPLATE", payload: { templateId: "t", sourceProjectPath: "/x.aep" } },
      new Date("2026-01-01T00:00:00.000Z")
    );
    await claim(workerId, workerToken);
    await report(workerId, workerToken, job.id, { status: "RUNNING" });

    const response = await uploadRaw(workerId, workerToken, job.id, "LANDSCAPE", Buffer.from("bytes"));
    expect(response.statusCode).toBe(409);
  });

  it("rejects a variant that does not match this job's own RENDER request", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningRenderJob(workerId, projectId, "LANDSCAPE");
    await claim(workerId, workerToken);
    await report(workerId, workerToken, job.id, { status: "RUNNING" });

    const response = await uploadRaw(workerId, workerToken, job.id, "REELS", Buffer.from("bytes"));
    expect(response.statusCode).toBe(409);
  });

  it("enforces the configured max upload size and cleans up - no orphaned file is left in storage", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningRenderJob(workerId, projectId);
    await claim(workerId, workerToken);
    await report(workerId, workerToken, job.id, { status: "RUNNING" });

    const oversized = Buffer.alloc(RENDER_MAX_UPLOAD_BYTES + 1, 1);
    const response = await uploadRaw(workerId, workerToken, job.id, "LANDSCAPE", oversized);
    expect(response.statusCode).toBe(413);

    expect(await harness.renderArtifactUploadRepository.findByJobId(job.id)).toBeNull();
    // No project directory (and therefore no file) was ever created for this rejected upload.
    expect(readdirSync(harness.storageRoot)).not.toContain(projectId);
  });

  it("succeeds and persists a real, server-verified upload record", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningRenderJob(workerId, projectId);
    await claim(workerId, workerToken);
    await report(workerId, workerToken, job.id, { status: "RUNNING" });

    const bytes = Buffer.from("real render bytes");
    const response = await uploadRaw(workerId, workerToken, job.id, "LANDSCAPE", bytes);
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.byteSize).toBe(bytes.length);
    expect(body.sha256).toHaveLength(64);

    const record = await harness.renderArtifactUploadRepository.findByJobId(job.id);
    expect(record).not.toBeNull();
    expect(record?.byteSize).toBe(bytes.length);
  });

  it("is idempotent for a duplicate upload with IDENTICAL bytes - never creates a second row or leaves an orphaned duplicate file", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningRenderJob(workerId, projectId);
    await claim(workerId, workerToken);
    await report(workerId, workerToken, job.id, { status: "RUNNING" });

    const bytes = Buffer.from("identical bytes twice");
    const first = await uploadRaw(workerId, workerToken, job.id, "LANDSCAPE", bytes);
    const second = await uploadRaw(workerId, workerToken, job.id, "LANDSCAPE", bytes);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().id).toBe(second.json().id);

    const projectDir = join(harness.storageRoot, projectId);
    expect(readdirSync(projectDir)).toHaveLength(1); // the duplicate's own written file was cleaned up
  });

  it("replaces the upload record (and removes the OLD storage object) when a retry uploads DIFFERENT bytes for the same job", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningRenderJob(workerId, projectId);
    await claim(workerId, workerToken);
    await report(workerId, workerToken, job.id, { status: "RUNNING" });

    const first = await uploadRaw(workerId, workerToken, job.id, "LANDSCAPE", Buffer.from("first attempt bytes"));
    const second = await uploadRaw(workerId, workerToken, job.id, "LANDSCAPE", Buffer.from("second, different, longer attempt bytes"));
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().id).toBe(second.json().id); // same row, replaced in place
    expect(second.json().byteSize).toBe(Buffer.from("second, different, longer attempt bytes").length);

    const projectDir = join(harness.storageRoot, projectId);
    expect(readdirSync(projectDir)).toHaveLength(1); // the old object was removed, never left orphaned
  });
});
