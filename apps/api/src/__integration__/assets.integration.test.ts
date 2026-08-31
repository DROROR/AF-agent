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
import { DrizzleFullPreviewArtifactRepository } from "../infrastructure/db/drizzle-full-preview-artifact-repository.js";
import { DrizzleUserAiProviderRepository } from "../infrastructure/db/drizzle-user-ai-provider-repository.js";
import { LocalFilesystemAssetStorage } from "../infrastructure/storage/local-filesystem-asset-storage.js";
import { DrizzleJobRepository } from "../infrastructure/db/drizzle-job-repository.js";
import { DrizzleProjectRepository } from "../infrastructure/db/drizzle-project-repository.js";
import { DrizzleSessionRepository } from "../infrastructure/db/drizzle-session-repository.js";
import { DrizzleUserRepository } from "../infrastructure/db/drizzle-user-repository.js";
import { DrizzleWorkerRepository } from "../infrastructure/db/drizzle-worker-repository.js";
import { createTestDatabase } from "./test-database.js";

const REGISTRATION_SECRET = "test-registration-secret-1234567890";
const STALE_AFTER_MS = 30_000;
const MAX_UPLOAD_BYTES = 1000;

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
            layerName: "Headline",
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
      ASSET_MAX_UPLOAD_BYTES: MAX_UPLOAD_BYTES,
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
    fullPreviewArtifactRepository: new DrizzleFullPreviewArtifactRepository(db),
    userAiProviderRepository: new DrizzleUserAiProviderRepository(db),
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
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/projects",
    ...authed(),
    payload: { name: "Test Project", manifest: manifest() }
  });
  return response.json().projectId;
}

function pngFormData(bytes: string, filename = "hero.png", mediaKind?: string): FormData {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), filename);
  if (mediaKind) {
    form.append("mediaKind", mediaKind);
  }
  return form;
}

async function uploadAssetViaApi(projectId: string, bytes = "fake png bytes", filename = "hero.png") {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/assets`,
    ...authed(),
    payload: pngFormData(bytes, filename)
  });
  return response;
}

describe("Asset Catalog API", () => {
  it("rejects every route when unauthenticated", async () => {
    const projectId = await createProjectViaApi();
    const uploaded = await uploadAssetViaApi(projectId);
    const assetId = uploaded.json().asset.id;

    const requests = [
      { method: "GET" as const, url: `/api/projects/${projectId}/assets` },
      { method: "POST" as const, url: `/api/projects/${projectId}/assets` },
      { method: "GET" as const, url: `/api/projects/${projectId}/assets/${assetId}` },
      { method: "GET" as const, url: `/api/projects/${projectId}/assets/${assetId}/file` },
      { method: "PATCH" as const, url: `/api/projects/${projectId}/assets/${assetId}` },
      { method: "DELETE" as const, url: `/api/projects/${projectId}/assets/${assetId}` }
    ];
    for (const r of requests) {
      const response = await harness.app.inject({ method: r.method, url: r.url });
      expect(response.statusCode).toBe(401);
    }
  });

  it("uploads a real file via multipart, computes sha256 server-side, and lists it back", async () => {
    const projectId = await createProjectViaApi();
    const response = await uploadAssetViaApi(projectId, "real bytes");
    expect(response.statusCode).toBe(201);
    const asset = response.json().asset;
    expect(asset.mediaKind).toBe("IMAGE");
    expect(asset.byteSize).toBe(Buffer.from("real bytes").length);
    expect(asset.sha256).toHaveLength(64);

    const list = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/assets`, ...authed() });
    expect(list.json().assets).toHaveLength(1);
    expect(list.json().assets[0].id).toBe(asset.id);
  });

  it("accepts an explicit LOGO mediaKind override for an image upload", async () => {
    const projectId = await createProjectViaApi();
    const form = pngFormData("logo bytes", "logo.png", "LOGO");
    const response = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/assets`,
      ...authed(),
      payload: form
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().asset.mediaKind).toBe("LOGO");
  });

  it("rejects an unsupported MIME type with 415", async () => {
    const projectId = await createProjectViaApi();
    const form = new FormData();
    form.append("file", new Blob(["<svg/>"], { type: "image/svg+xml" }), "vector.svg");
    const response = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/assets`, ...authed(), payload: form });
    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects an upload over the configured size limit with 413", async () => {
    const projectId = await createProjectViaApi();
    const response = await uploadAssetViaApi(projectId, "x".repeat(MAX_UPLOAD_BYTES + 1));
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("gets a single asset and streams its real file bytes back", async () => {
    const projectId = await createProjectViaApi();
    const uploaded = await uploadAssetViaApi(projectId, "file bytes");
    const assetId = uploaded.json().asset.id;

    const get = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/assets/${assetId}`, ...authed() });
    expect(get.statusCode).toBe(200);
    expect(get.json().asset.id).toBe(assetId);

    const file = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/assets/${assetId}/file`, ...authed() });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.rawPayload.toString()).toBe("file bytes");
  });

  it("updates label/notes via PATCH", async () => {
    const projectId = await createProjectViaApi();
    const uploaded = await uploadAssetViaApi(projectId);
    const assetId = uploaded.json().asset.id;

    const response = await harness.app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/assets/${assetId}`,
      ...authed(),
      payload: { label: "Client logo" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().asset.label).toBe("Client logo");
  });

  it("deletes an unmapped asset", async () => {
    const projectId = await createProjectViaApi();
    const uploaded = await uploadAssetViaApi(projectId);
    const assetId = uploaded.json().asset.id;

    const response = await harness.app.inject({ method: "DELETE", url: `/api/projects/${projectId}/assets/${assetId}`, ...authed() });
    expect(response.statusCode).toBe(204);

    const get = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/assets/${assetId}`, ...authed() });
    expect(get.statusCode).toBe(404);
  });

  it("rejects cross-project access to an asset with 404 - never confirms it exists in another project", async () => {
    const projectA = await createProjectViaApi();
    const projectB = await createProjectViaApi();
    const uploaded = await uploadAssetViaApi(projectA);
    const assetId = uploaded.json().asset.id;

    const get = await harness.app.inject({ method: "GET", url: `/api/projects/${projectB}/assets/${assetId}`, ...authed() });
    expect(get.statusCode).toBe(404);
    expect(get.json().error.code).toBe("ASSET_NOT_FOUND");

    const del = await harness.app.inject({ method: "DELETE", url: `/api/projects/${projectB}/assets/${assetId}`, ...authed() });
    expect(del.statusCode).toBe(404);
  });

  it("refuses to delete an asset still mapped in the current execution plan (409), then allows it after CLEAR_ASSET", async () => {
    const projectId = await createProjectViaApi();
    const uploaded = await uploadAssetViaApi(projectId);
    const assetId = uploaded.json().asset.id;

    const plan = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    const scenePlanId = plan.json().plan.scenePlans[0].id;
    const mappingId = plan.json().plan.scenePlans[0].mappings[0].id;

    const mapped = await harness.app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/execution-plan`,
      ...authed(),
      payload: { baseRevision: 1, operations: [{ type: "MAP_ASSET", scenePlanId, mappingId, selectedAssetId: assetId, selectedAssetType: "image" }] }
    });
    expect(mapped.statusCode).toBe(200);

    const blockedDelete = await harness.app.inject({ method: "DELETE", url: `/api/projects/${projectId}/assets/${assetId}`, ...authed() });
    expect(blockedDelete.statusCode).toBe(409);

    await harness.app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/execution-plan`,
      ...authed(),
      payload: { baseRevision: 2, operations: [{ type: "CLEAR_ASSET", scenePlanId, mappingId }] }
    });

    const allowedDelete = await harness.app.inject({ method: "DELETE", url: `/api/projects/${projectId}/assets/${assetId}`, ...authed() });
    expect(allowedDelete.statusCode).toBe(204);
  });

  it("rejects MAP_ASSET on the execution plan for an asset id from a different project", async () => {
    const projectA = await createProjectViaApi();
    const projectB = await createProjectViaApi();
    const uploaded = await uploadAssetViaApi(projectA);
    const assetId = uploaded.json().asset.id;

    const plan = await harness.app.inject({ method: "POST", url: `/api/projects/${projectB}/execution-plan`, ...authed() });
    const scenePlanId = plan.json().plan.scenePlans[0].id;
    const mappingId = plan.json().plan.scenePlans[0].mappings[0].id;

    const response = await harness.app.inject({
      method: "PATCH",
      url: `/api/projects/${projectB}/execution-plan`,
      ...authed(),
      payload: { baseRevision: 1, operations: [{ type: "MAP_ASSET", scenePlanId, mappingId, selectedAssetId: assetId, selectedAssetType: "image" }] }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("ASSET_NOT_FOUND");
  });

  it("refuses to delete an asset currently set as the project's brand logo (409), then allows it once the logo is cleared", async () => {
    const projectId = await createProjectViaApi();
    const uploaded = await uploadAssetViaApi(projectId);
    const assetId = uploaded.json().asset.id;

    const setLogo = await harness.app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/brand-inputs`,
      ...authed(),
      payload: { logoAssetId: assetId, brandColors: [], textInstructions: null }
    });
    expect(setLogo.statusCode).toBe(200);

    const blockedDelete = await harness.app.inject({ method: "DELETE", url: `/api/projects/${projectId}/assets/${assetId}`, ...authed() });
    expect(blockedDelete.statusCode).toBe(409);

    const clearLogo = await harness.app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/brand-inputs`,
      ...authed(),
      payload: { logoAssetId: null, brandColors: [], textInstructions: null }
    });
    expect(clearLogo.statusCode).toBe(200);

    const allowedDelete = await harness.app.inject({ method: "DELETE", url: `/api/projects/${projectId}/assets/${assetId}`, ...authed() });
    expect(allowedDelete.statusCode).toBe(204);
  });
});
