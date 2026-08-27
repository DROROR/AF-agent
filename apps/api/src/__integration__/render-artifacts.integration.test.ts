import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SCHEMA_VERSION, authSessionResponseSchema } from "@dyo/schemas";
import { buildApp } from "../app.js";
import { DrizzleJobRepository } from "../infrastructure/db/drizzle-job-repository.js";
import { DrizzleSessionRepository } from "../infrastructure/db/drizzle-session-repository.js";
import { DrizzleUserRepository } from "../infrastructure/db/drizzle-user-repository.js";
import { DrizzleWorkerRepository } from "../infrastructure/db/drizzle-worker-repository.js";
import { DrizzleProjectRepository } from "../infrastructure/db/drizzle-project-repository.js";
import { DrizzleExecutionPlanRepository } from "../infrastructure/db/drizzle-execution-plan-repository.js";
import { DrizzleAssetRepository } from "../infrastructure/db/drizzle-asset-repository.js";
import { DrizzleWorkMapRepository } from "../infrastructure/db/drizzle-work-map-repository.js";
import { DrizzleMappingSuggestionRepository } from "../infrastructure/db/drizzle-mapping-suggestion-repository.js";
import { DrizzleSceneEvidenceRepository } from "../infrastructure/db/drizzle-scene-evidence-repository.js";
import { DrizzleRenderArtifactRepository } from "../infrastructure/db/drizzle-render-artifact-repository.js";
import { DrizzleRenderArtifactUploadRepository } from "../infrastructure/db/drizzle-render-artifact-upload-repository.js";
import { NotConfiguredAiSuggestionProvider } from "../application/mapping-assistant/ai-suggestion-provider.js";
import { LocalFilesystemAssetStorage } from "../infrastructure/storage/local-filesystem-asset-storage.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "./test-database.js";

const REGISTRATION_SECRET = "test-registration-secret-1234567890";
const STALE_AFTER_MS = 30_000;

async function setup() {
  const { db, close } = await createTestDatabase();
  const renderArtifactRepository = new DrizzleRenderArtifactRepository(db);
  const renderArtifactUploadRepository = new DrizzleRenderArtifactUploadRepository(db);
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
    assetRepository: new DrizzleAssetRepository(db),
    assetStorage: new LocalFilesystemAssetStorage(mkdtempSync(join(tmpdir(), "dyo-test-assets-"))),
    workMapRepository: new DrizzleWorkMapRepository(db),
    mappingSuggestionRepository: new DrizzleMappingSuggestionRepository(db),
    sceneEvidenceRepository: new DrizzleSceneEvidenceRepository(db),
    renderArtifactRepository,
    renderArtifactUploadRepository,
    aiSuggestionProvider: new NotConfiguredAiSuggestionProvider(),
    checkDatabaseHealth: async () => {
      await db.execute("select 1");
      return true;
    }
  });
  return { app, close, renderArtifactRepository, renderArtifactUploadRepository, jobRepository };
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

async function createProject(name = "Render Artifacts Test Project"): Promise<string> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: {
      name,
      manifest: {
        schemaVersion: SCHEMA_VERSION,
        templateId: "tmpl-1",
        templateName: "tmpl-1",
        sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "e".repeat(64) },
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

async function seedArtifact(projectId: string) {
  const registerResponse = await harness.app.inject({
    method: "POST",
    url: "/api/workers/register",
    headers: { authorization: `Bearer ${REGISTRATION_SECRET}` },
    payload: { name: "Render Test Worker", maxConcurrency: 1, capabilities: ["RENDER"] }
  });
  const { workerId } = registerResponse.json();

  const jobId = randomUUID();
  await harness.jobRepository.create(
    { id: jobId, workerId, projectId, operation: "RENDER", payload: {} },
    new Date("2026-01-01T00:00:00.000Z")
  );
  return harness.renderArtifactRepository.record(
    {
      id: randomUUID(),
      projectId,
      jobId,
      variant: "LANDSCAPE",
      compositionName: "Landscape Master",
      workingProjectSha256: "f".repeat(64),
      filename: "output.mp4",
      mimeType: "video/mp4",
      byteSize: 4096,
      storageKey: `${projectId}/${randomUUID()}.mp4`,
      sha256: "f".repeat(64),
      renderStartedAt: new Date("2026-01-01T00:00:00.000Z"),
      renderCompletedAt: new Date("2026-01-01T00:00:05.000Z"),
      aerenderExitCode: 0,
      logExcerpt: "ok"
    },
    new Date("2026-01-01T00:00:05.000Z")
  );
}

describe("GET /api/projects/:projectId/render-artifacts", () => {
  it("requires an authenticated dashboard session", async () => {
    const projectId = await createProject();
    const response = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/render-artifacts` });
    expect(response.statusCode).toBe(401);
  });

  it("returns 404 for a project that does not exist", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/projects/${randomUUID()}/render-artifacts`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns an empty list for a real project with no renders yet", async () => {
    const projectId = await createProject();
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/render-artifacts`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().artifacts).toEqual([]);
  });

  it("returns the real persisted artifact metadata for this project, never a filesystem path", async () => {
    const projectId = await createProject();
    await seedArtifact(projectId);

    const response = await harness.app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/render-artifacts`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(response.statusCode).toBe(200);
    const { artifacts } = response.json();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].variant).toBe("LANDSCAPE");
    expect(artifacts[0].byteSize).toBe(4096);
    expect(artifacts[0].filename).toBe("output.mp4");
    expect(JSON.stringify(artifacts[0])).not.toMatch(/[a-zA-Z]:\\|\/work\/|\/home\//);
  });

  it("never returns another project's render artifacts (project-scoped)", async () => {
    const projectA = await createProject("Project A");
    const projectB = await createProject("Project B");
    await seedArtifact(projectA);

    const response = await harness.app.inject({
      method: "GET",
      url: `/api/projects/${projectB}/render-artifacts`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().artifacts).toEqual([]);
  });
});
