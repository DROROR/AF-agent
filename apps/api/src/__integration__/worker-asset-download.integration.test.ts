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

async function setup() {
  const { db, close } = await createTestDatabase();
  const storageRoot = mkdtempSync(join(tmpdir(), "dyo-test-worker-asset-download-"));
  const jobRepository = new DrizzleJobRepository(db);
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
    executionPlanRepository: new DrizzleExecutionPlanRepository(db),
    executionSessionRepository: new DrizzleExecutionSessionRepository(db),
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
  return { app, close, jobRepository };
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
      name: "Asset Download Test Project",
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

async function uploadAsset(projectId: string, bytes: Buffer, filename = "hero.jpg", mimeType = "image/jpeg") {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), filename);
  const encoded = new Request("http://upload.local", { method: "POST", body: form });
  const payload = Buffer.from(await encoded.arrayBuffer());
  const contentType = encoded.headers.get("content-type") ?? "";

  const response = await harness.app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/assets`,
    headers: { authorization: `Bearer ${sessionToken}`, "content-type": contentType },
    payload
  });
  expect(response.statusCode).toBe(201);
  return response.json().asset.id as string;
}

async function registerWorker(capabilities: string[] = ["EXECUTE_FRAME"]) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/workers/register",
    headers: { authorization: `Bearer ${REGISTRATION_SECRET}` },
    payload: { name: "Execute Frame Worker", maxConcurrency: 1, capabilities }
  });
  return registerWorkerResponseSchema.parse(response.json());
}

async function createRunningExecuteFrameJob(workerId: string, projectId: string) {
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
        sourceProjectSha256: "a".repeat(64),
        sourceProjectPath: "/copies/test.aep",
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

async function claimAndReachRunning(workerId: string, workerToken: string, projectId: string) {
  const job = await createRunningExecuteFrameJob(workerId, projectId);
  await harness.app.inject({
    method: "POST",
    url: `/api/workers/${workerId}/jobs/claim`,
    headers: { authorization: `Bearer ${workerToken}` }
  });
  await harness.app.inject({
    method: "POST",
    url: `/api/workers/${workerId}/jobs/${job.id}/report`,
    headers: { authorization: `Bearer ${workerToken}` },
    payload: { status: "RUNNING" }
  });
  return job;
}

function downloadUrl(workerId: string, jobId: string, assetId: string): string {
  return `/api/workers/${workerId}/jobs/${jobId}/assets/${assetId}/file`;
}

describe("GET /api/workers/:workerId/jobs/:jobId/assets/:assetId/file", () => {
  it("requires the worker's bearer token", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await claimAndReachRunning(workerId, workerToken, projectId);
    const assetId = await uploadAsset(projectId, Buffer.from("real image bytes"));

    const response = await harness.app.inject({ method: "GET", url: downloadUrl(workerId, job.id, assetId) });
    expect(response.statusCode).toBe(401);
  });

  it("returns 404 when the job belongs to a different worker", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await claimAndReachRunning(workerId, workerToken, projectId);
    const assetId = await uploadAsset(projectId, Buffer.from("real image bytes"));
    const { workerId: otherWorkerId, workerToken: otherToken } = await registerWorker();

    const response = await harness.app.inject({
      method: "GET",
      url: downloadUrl(otherWorkerId, job.id, assetId),
      headers: { authorization: `Bearer ${otherToken}` }
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 409 when the job is not RUNNING (still QUEUED)", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningExecuteFrameJob(workerId, projectId);
    const assetId = await uploadAsset(projectId, Buffer.from("real image bytes"));

    const response = await harness.app.inject({
      method: "GET",
      url: downloadUrl(workerId, job.id, assetId),
      headers: { authorization: `Bearer ${workerToken}` }
    });
    expect(response.statusCode).toBe(409);
  });

  it("returns 409 when the job's operation is not EXECUTE_FRAME", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker(["RENDER"]);
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
          variant: "LANDSCAPE",
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
    await harness.app.inject({ method: "POST", url: `/api/workers/${workerId}/jobs/claim`, headers: { authorization: `Bearer ${workerToken}` } });
    await harness.app.inject({
      method: "POST",
      url: `/api/workers/${workerId}/jobs/${job.id}/report`,
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { status: "RUNNING" }
    });
    const assetId = await uploadAsset(projectId, Buffer.from("real image bytes"));

    const response = await harness.app.inject({
      method: "GET",
      url: downloadUrl(workerId, job.id, assetId),
      headers: { authorization: `Bearer ${workerToken}` }
    });
    expect(response.statusCode).toBe(409);
  });

  it("returns 404 for an asset belonging to a DIFFERENT project than this job's own - cross-project download refused", async () => {
    const projectId = await createProject();
    const otherProjectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await claimAndReachRunning(workerId, workerToken, projectId);
    const assetId = await uploadAsset(otherProjectId, Buffer.from("belongs to the other project"));

    const response = await harness.app.inject({
      method: "GET",
      url: downloadUrl(workerId, job.id, assetId),
      headers: { authorization: `Bearer ${workerToken}` }
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for an asset id that does not exist at all", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await claimAndReachRunning(workerId, workerToken, projectId);

    const response = await harness.app.inject({
      method: "GET",
      url: downloadUrl(workerId, job.id, randomUUID()),
      headers: { authorization: `Bearer ${workerToken}` }
    });
    expect(response.statusCode).toBe(404);
  });

  it("streams the real bytes with the real content-type and filename - never a storage key/filesystem path", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await claimAndReachRunning(workerId, workerToken, projectId);
    const realBytes = Buffer.from("the exact real asset bytes, byte for byte");
    const assetId = await uploadAsset(projectId, realBytes, "hero.jpg", "image/jpeg");

    const response = await harness.app.inject({
      method: "GET",
      url: downloadUrl(workerId, job.id, assetId),
      headers: { authorization: `Bearer ${workerToken}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/jpeg");
    expect(response.headers["content-disposition"]).toContain("hero.jpg");
    expect(response.headers["content-disposition"]).not.toMatch(/\/|storageKey/i);
    expect(Buffer.from(response.rawPayload)).toEqual(realBytes);
  });

  it("stays healthy (200, well-formed header) for an unusual uploaded filename - see safeContentDispositionFilename's own unit tests for the exact escaping rules; Node's real multipart encoder already percent-encodes a literal quote before it reaches the server, so this only proves the endpoint never breaks end to end", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await claimAndReachRunning(workerId, workerToken, projectId);
    const assetId = await uploadAsset(projectId, Buffer.from("bytes"), 'evil".jpg', "image/jpeg");

    const response = await harness.app.inject({
      method: "GET",
      url: downloadUrl(workerId, job.id, assetId),
      headers: { authorization: `Bearer ${workerToken}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename=".*"$/);
  });
});
