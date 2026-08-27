import { beforeEach, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SCHEMA_VERSION, authSessionResponseSchema, type TemplateManifest } from "@dyo/schemas";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../app.js";
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
import { DrizzleJobRepository } from "../infrastructure/db/drizzle-job-repository.js";
import { DrizzleProjectRepository } from "../infrastructure/db/drizzle-project-repository.js";
import { DrizzleSessionRepository } from "../infrastructure/db/drizzle-session-repository.js";
import { DrizzleUserRepository } from "../infrastructure/db/drizzle-user-repository.js";
import { DrizzleWorkerRepository } from "../infrastructure/db/drizzle-worker-repository.js";
import { createTestDatabase } from "./test-database.js";

const REGISTRATION_SECRET = "test-registration-secret-1234567890";
const STALE_AFTER_MS = 30_000;

function manifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: "2026-08-26T00:00:00.000Z",
    compositions: [
      { compositionId: "comp-1", aeProjectItemIndex: 1, name: "Scene A", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
    ],
    scenes: [
      {
        sceneId: "scene-a",
        displayName: null,
        compositionId: "comp-1",
        originalOrderIndex: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
        placeholders: [
          {
            placeholderId: "ph-1",
            displayLabel: null,
            compositionId: "comp-1",
            layerName: "Hero Image",
            layerIndex: 1,
            layerPath: [],
            placeholderType: "image",
            editable: true,
            sourceType: "AVLayer",
            dimensions: null,
            startTimeSeconds: 0,
            durationSeconds: 5,
            evidence: { source: "read_directly", reason: "AVLayer confirmed via ae_get_composition" }
          }
        ]
      }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

async function setup() {
  const { db, close } = await createTestDatabase();
  const app: FastifyInstance = await buildApp({
    env: {
      WORKER_REGISTRATION_SECRET: REGISTRATION_SECRET,
      WORKER_HEARTBEAT_STALE_AFTER_MS: STALE_AFTER_MS,
      LOG_LEVEL: "silent" as never,
      ASSET_MAX_UPLOAD_BYTES: 1_000_000,
      RENDER_ARTIFACT_MAX_UPLOAD_BYTES: 2_000_000_000
    },
    workerRepository: new DrizzleWorkerRepository(db),
    jobRepository: new DrizzleJobRepository(db),
    userRepository: new DrizzleUserRepository(db),
    sessionRepository: new DrizzleSessionRepository(db),
    projectRepository: new DrizzleProjectRepository(db),
    executionPlanRepository: new DrizzleExecutionPlanRepository(db),
    executionSessionRepository: new DrizzleExecutionSessionRepository(db),
    assetRepository: new DrizzleAssetRepository(db),
    assetStorage: new LocalFilesystemAssetStorage(mkdtempSync(join(tmpdir(), "dyo-test-assets-"))),
    workMapRepository: new DrizzleWorkMapRepository(db),
    mappingSuggestionRepository: new DrizzleMappingSuggestionRepository(db),
    sceneEvidenceRepository: new DrizzleSceneEvidenceRepository(db),
    renderArtifactRepository: new DrizzleRenderArtifactRepository(db),
    renderArtifactUploadRepository: new DrizzleRenderArtifactUploadRepository(db),
    aiSuggestionProvider: new NotConfiguredAiSuggestionProvider(),
    checkDatabaseHealth: async () => {
      await db.execute("select 1");
      return true;
    }
  });
  return { app, close };
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

function authed(token = sessionToken) {
  return token ? { headers: { authorization: `Bearer ${token}` } } : {};
}

async function createProjectViaApi(): Promise<string> {
  const response = await harness.app.inject({ method: "POST", url: "/api/projects", ...authed(), payload: { name: "Test Project", manifest: manifest() } });
  return response.json().projectId;
}

async function createPlanViaApi(projectId: string) {
  const response = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
  return response.json();
}

async function uploadAssetViaApi(projectId: string) {
  const form = new FormData();
  form.append("file", new Blob(["bytes"], { type: "image/png" }), "hero.png");
  const response = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/assets`, ...authed(), payload: form });
  return response.json().asset;
}

describe("Mapping Assistant API", () => {
  it("rejects every route when unauthenticated", async () => {
    const projectId = await createProjectViaApi();
    const requests = [
      { method: "POST" as const, url: `/api/projects/${projectId}/mapping-suggestions/generate` },
      { method: "GET" as const, url: `/api/projects/${projectId}/mapping-suggestions` },
      { method: "POST" as const, url: `/api/projects/${projectId}/mapping-suggestions/x/accept` },
      { method: "POST" as const, url: `/api/projects/${projectId}/mapping-suggestions/x/reject` },
      { method: "POST" as const, url: `/api/projects/${projectId}/mapping-suggestions/accept-batch` }
    ];
    for (const r of requests) {
      const response = await harness.app.inject({ method: r.method, url: r.url });
      expect(response.statusCode).toBe(401);
    }
  });

  it("generates a DETERMINISTIC suggestion from an explicit Work Map asset reference, and reports AI as unavailable", async () => {
    const projectId = await createProjectViaApi();
    await createPlanViaApi(projectId);
    const asset = await uploadAssetViaApi(projectId);
    await harness.app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/work-map`,
      ...authed(),
      payload: { baseRevision: 0, entries: [{ sourceCompositionId: "comp-1", sourceReference: null, desiredAssetId: asset.id, desiredText: null, assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null }] }
    });

    const response = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/mapping-suggestions/generate`, ...authed() });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.aiAvailable).toBe(false);
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]).toMatchObject({ source: "DETERMINISTIC", status: "PENDING", suggestedAssetId: asset.id });

    const list = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/mapping-suggestions`, ...authed() });
    expect(list.json().suggestions).toHaveLength(1);
  });

  it("accepts a suggestion via the real typed MAP_ASSET edit and bumps the plan revision", async () => {
    const projectId = await createProjectViaApi();
    await createPlanViaApi(projectId);
    const asset = await uploadAssetViaApi(projectId);
    await harness.app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/work-map`,
      ...authed(),
      payload: { baseRevision: 0, entries: [{ sourceCompositionId: "comp-1", sourceReference: null, desiredAssetId: asset.id, desiredText: null, assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null }] }
    });
    const generated = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/mapping-suggestions/generate`, ...authed() });
    const suggestionId = generated.json().suggestions[0].id;

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/mapping-suggestions/${suggestionId}/accept`,
      ...authed(),
      payload: { baseRevision: 1 }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.suggestion.status).toBe("ACCEPTED");
    expect(body.executionPlan.plan.revision).toBe(2);
    expect(body.executionPlan.plan.scenePlans[0].mappings[0].selectedAssetId).toBe(asset.id);
  });

  it("rejects a suggestion and leaves the plan completely unchanged", async () => {
    const projectId = await createProjectViaApi();
    await createPlanViaApi(projectId);
    const asset = await uploadAssetViaApi(projectId);
    await harness.app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/work-map`,
      ...authed(),
      payload: { baseRevision: 0, entries: [{ sourceCompositionId: "comp-1", sourceReference: null, desiredAssetId: asset.id, desiredText: null, assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null }] }
    });
    const generated = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/mapping-suggestions/generate`, ...authed() });
    const suggestionId = generated.json().suggestions[0].id;

    const response = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/mapping-suggestions/${suggestionId}/reject`, ...authed() });
    expect(response.statusCode).toBe(200);
    expect(response.json().suggestion.status).toBe("REJECTED");

    const plan = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    expect(plan.json().plan.revision).toBe(1);
  });

  it("rejects an accept with a stale baseRevision (409), same as a manual edit", async () => {
    const projectId = await createProjectViaApi();
    await createPlanViaApi(projectId);
    const asset = await uploadAssetViaApi(projectId);
    await harness.app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/work-map`,
      ...authed(),
      payload: { baseRevision: 0, entries: [{ sourceCompositionId: "comp-1", sourceReference: null, desiredAssetId: asset.id, desiredText: null, assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null }] }
    });
    const generated = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/mapping-suggestions/generate`, ...authed() });
    const suggestionId = generated.json().suggestions[0].id;

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/mapping-suggestions/${suggestionId}/accept`,
      ...authed(),
      payload: { baseRevision: 999 }
    });
    expect(response.statusCode).toBe(409);
  });

  it("rejects cross-project suggestion access with 404 - never confirms it exists in another project", async () => {
    const projectA = await createProjectViaApi();
    const projectB = await createProjectViaApi();
    await createPlanViaApi(projectA);
    const asset = await uploadAssetViaApi(projectA);
    await harness.app.inject({
      method: "PUT",
      url: `/api/projects/${projectA}/work-map`,
      ...authed(),
      payload: { baseRevision: 0, entries: [{ sourceCompositionId: "comp-1", sourceReference: null, desiredAssetId: asset.id, desiredText: null, assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null }] }
    });
    const generated = await harness.app.inject({ method: "POST", url: `/api/projects/${projectA}/mapping-suggestions/generate`, ...authed() });
    const suggestionId = generated.json().suggestions[0].id;

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectB}/mapping-suggestions/${suggestionId}/accept`,
      ...authed(),
      payload: { baseRevision: 1 }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("SUGGESTION_NOT_FOUND");
  });
});
