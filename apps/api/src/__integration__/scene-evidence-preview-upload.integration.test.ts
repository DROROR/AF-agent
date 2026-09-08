import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SCHEMA_VERSION, authSessionResponseSchema, registerWorkerResponseSchema, sceneEvidencePreviewUploadPath } from "@dyo/schemas";
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

/**
 * Live QA regression, 2026-09-07: this exact route (correctly registered
 * in Fastify and reachable directly against 127.0.0.1:4000) was 404ing
 * for every real Worker on production because deploy/nginx/
 * worker-api.dyocourses.com.conf's own separate path allowlist never had
 * a location block for it. This test proves the FASTIFY side of the
 * contract end to end (the part `npm test` can actually exercise -
 * nginx's own config is real infra, not application code, and is fixed
 * directly in that .conf file/its own comment, not here). It cannot, by
 * itself, prove nginx is configured correctly - see this file's own
 * sibling test below that pins the Worker's own URL-building function
 * against the exact route string this file registers, so the two can
 * never silently drift from EACH OTHER again either.
 */
const REGISTRATION_SECRET = "test-registration-secret-1234567890";
const STALE_AFTER_MS = 30_000;
const MAX_UPLOAD_BYTES = 1000;
const SOURCE_SHA = "a".repeat(64);

async function setup() {
  const { db, close } = await createTestDatabase();
  const storageRoot = mkdtempSync(join(tmpdir(), "dyo-test-scene-evidence-previews-"));
  const jobRepository = new DrizzleJobRepository(db);
  const sceneEvidencePreviewRepository = new DrizzleSceneEvidencePreviewRepository(db);
  const executionPlanRepository = new DrizzleExecutionPlanRepository(db);
  const app: FastifyInstance = await buildApp({
    env: {
      WORKER_REGISTRATION_SECRET: REGISTRATION_SECRET,
      WORKER_HEARTBEAT_STALE_AFTER_MS: STALE_AFTER_MS,
      LOG_LEVEL: "silent" as never,
      ASSET_MAX_UPLOAD_BYTES: 10_000_000,
      RENDER_ARTIFACT_MAX_UPLOAD_BYTES: MAX_UPLOAD_BYTES
    },
    workerRepository: new DrizzleWorkerRepository(db),
    jobRepository,
    userRepository: new DrizzleUserRepository(db),
    sessionRepository: new DrizzleSessionRepository(db),
    projectRepository: new DrizzleProjectRepository(db),
    executionPlanRepository,
    executionSessionRepository: new DrizzleExecutionSessionRepository(db),
    assetRepository: new DrizzleAssetRepository(db),
    assetStorage: new LocalFilesystemAssetStorage(storageRoot),
    workMapRepository: new DrizzleWorkMapRepository(db),
    mappingSuggestionRepository: new DrizzleMappingSuggestionRepository(db),
    sceneEvidenceRepository: new DrizzleSceneEvidenceRepository(db),
    renderArtifactRepository: new DrizzleRenderArtifactRepository(db),
    renderArtifactUploadRepository: new DrizzleRenderArtifactUploadRepository(db),
    fullPreviewArtifactRepository: new DrizzleFullPreviewArtifactRepository(db),
    sceneEvidencePreviewRepository,
    userAiProviderRepository: new DrizzleUserAiProviderRepository(db),
    checkDatabaseHealth: async () => {
      await db.execute("select 1");
      return true;
    }
  });
  return { app, close, jobRepository, sceneEvidencePreviewRepository, executionPlanRepository, storageRoot };
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
      name: "Scene Evidence Preview Upload Test Project",
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

async function registerWorker(capabilities: string[] = ["INSPECT_SCENE_EVIDENCE"]) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/workers/register",
    headers: { authorization: `Bearer ${REGISTRATION_SECRET}` },
    payload: { name: "QA Worker", maxConcurrency: 1, capabilities }
  });
  return registerWorkerResponseSchema.parse(response.json());
}

async function createRunningSceneEvidenceJob(workerId: string, projectId: string) {
  return harness.jobRepository.create(
    {
      id: randomUUID(),
      workerId,
      projectId,
      operation: "INSPECT_SCENE_EVIDENCE",
      payload: {
        sourceProjectPath: "/copies/test.aep",
        sourceProjectSha256: SOURCE_SHA,
        manifestCompositionId: "comp-210",
        aeProjectItemIndex: 2,
        compositionName: "!Render",
        // The exact live QA shape - a zero-placeholder scene still gets a
        // real representative preview frame (live QA Blocker 2 fix).
        layerIndices: [],
        previewTimestampSeconds: 0
      }
    },
    new Date("2026-01-01T00:00:00.000Z")
  );
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

async function uploadRaw(workerId: string, workerToken: string | null, jobId: string, bytes: Buffer, mimeType = "image/png") {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), "preview.png");
  const encoded = new Request("http://upload.local", { method: "POST", body: form });
  const payload = Buffer.from(await encoded.arrayBuffer());
  const contentType = encoded.headers.get("content-type") ?? "";

  // Uses the EXACT same path-building function the real Worker calls
  // (apps/worker/src/infrastructure/api-client.ts) - see the standalone
  // "shares the exact route contract" test below for why this matters.
  return harness.app.inject({
    method: "POST",
    url: sceneEvidencePreviewUploadPath(workerId, jobId),
    headers: {
      ...(workerToken ? { authorization: `Bearer ${workerToken}` } : {}),
      "content-type": contentType
    },
    payload
  });
}

describe("POST /api/workers/:workerId/jobs/:jobId/scene-evidence-preview", () => {
  it("the Worker's own URL-building function produces exactly the route Fastify registers - the two contracts can never silently drift from each other again", () => {
    const url = sceneEvidencePreviewUploadPath("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222");
    expect(url).toBe("/api/workers/11111111-1111-1111-1111-111111111111/jobs/22222222-2222-2222-2222-222222222222/scene-evidence-preview");
    // The exact shape deploy/nginx/worker-api.dyocourses.com.conf's own
    // new location block matches - kept here as a live, code-level
    // reminder that a future path change must update BOTH.
    expect(url).toMatch(/^\/api\/workers\/[0-9a-fA-F-]+\/jobs\/[0-9a-fA-F-]+\/scene-evidence-preview$/);
  });

  it("requires the worker's bearer token", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningSceneEvidenceJob(workerId, projectId);
    await claim(workerId, workerToken);
    await report(workerId, workerToken, job.id, { status: "RUNNING" });

    const response = await uploadRaw(workerId, null, job.id, Buffer.from("png bytes"));
    expect(response.statusCode).toBe(401);
  });

  it("returns 404 when the job belongs to a different worker (never distinguishable from not-found) - fails closed, never a different Worker's evidence", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningSceneEvidenceJob(workerId, projectId);
    await claim(workerId, workerToken);
    await report(workerId, workerToken, job.id, { status: "RUNNING" });

    const { workerId: otherWorkerId, workerToken: otherToken } = await registerWorker();
    const response = await uploadRaw(otherWorkerId, otherToken, job.id, Buffer.from("png bytes"));
    expect(response.statusCode).toBe(404);
  });

  it("rejects an upload while the job is still only CLAIMED (not yet RUNNING)", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningSceneEvidenceJob(workerId, projectId);
    await claim(workerId, workerToken);
    // Deliberately never reported RUNNING.

    const response = await uploadRaw(workerId, workerToken, job.id, Buffer.from("png bytes"));
    expect(response.statusCode).toBe(409);
  });

  it("succeeds (2xx, never 404), persists a real scene_evidence_previews row, and preview-status then resolves it", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningSceneEvidenceJob(workerId, projectId);
    await claim(workerId, workerToken);
    await report(workerId, workerToken, job.id, { status: "RUNNING" });

    // preview-status resolves by scenePlanId -> manifestCompositionId via
    // the project's current execution plan (get-scene-evidence-preview.ts)
    // - a real plan with a matching scene is required for that lookup.
    await harness.executionPlanRepository.createRevision(
      {
        id: randomUUID(),
        projectId,
        revision: 1,
        status: "DRAFT",
        templateId: "tmpl-1",
        sourceProjectSha256: SOURCE_SHA,
        scenePlans: [
          {
            id: "scene-1",
            manifestCompositionId: "comp-210",
            compositionName: "!Render",
            use: true,
            sourcePosition: 0,
            finalOrder: 0,
            finalDuration: null,
            approvalState: "UNREVIEWED",
            instructions: null,
            notes: null,
            unresolvedReasons: [],
            evidence: [],
            mappings: [],
            reelsLayout: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ],
        approvedAt: null,
        approvedBy: null
      },
      new Date("2026-01-01T00:00:00.000Z")
    );

    const bytes = Buffer.from("real png bytes");
    const response = await uploadRaw(workerId, workerToken, job.id, bytes);
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.byteSize).toBe(bytes.length);
    expect(body.sha256).toHaveLength(64);

    const record = await harness.sceneEvidencePreviewRepository.findLatestForComposition(projectId, "comp-210");
    expect(record).not.toBeNull();
    expect(record?.jobId).toBe(job.id);

    const statusResponse = await harness.app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/execution-plan/scenes/scene-1/preview-status`,
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().preview).not.toBeNull();
    expect(statusResponse.json().preview.byteSize).toBe(bytes.length);
  });

  it("enforces the configured max upload size - the non-fatal Worker-side contract still applies: this is a real, typed rejection, never a silent drop", async () => {
    const projectId = await createProject();
    const { workerId, workerToken } = await registerWorker();
    const job = await createRunningSceneEvidenceJob(workerId, projectId);
    await claim(workerId, workerToken);
    await report(workerId, workerToken, job.id, { status: "RUNNING" });

    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 1);
    const response = await uploadRaw(workerId, workerToken, job.id, oversized);
    expect(response.statusCode).toBe(413);
  });
});
