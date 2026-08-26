import { beforeEach, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SCHEMA_VERSION, authSessionResponseSchema, type TemplateManifest } from "@dyo/schemas";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { DrizzleExecutionPlanRepository } from "../infrastructure/db/drizzle-execution-plan-repository.js";
import { DrizzleAssetRepository } from "../infrastructure/db/drizzle-asset-repository.js";
import { DrizzleWorkMapRepository } from "../infrastructure/db/drizzle-work-map-repository.js";
import { LocalFilesystemAssetStorage } from "../infrastructure/storage/local-filesystem-asset-storage.js";
import { DrizzleJobRepository } from "../infrastructure/db/drizzle-job-repository.js";
import { DrizzleProjectRepository } from "../infrastructure/db/drizzle-project-repository.js";
import { DrizzleSessionRepository } from "../infrastructure/db/drizzle-session-repository.js";
import { DrizzleUserRepository } from "../infrastructure/db/drizzle-user-repository.js";
import { DrizzleWorkerRepository } from "../infrastructure/db/drizzle-worker-repository.js";
import { createTestDatabase } from "./test-database.js";

const REGISTRATION_SECRET = "test-registration-secret-1234567890";
const STALE_AFTER_MS = 30_000;

async function setup() {
  const { db, close } = await createTestDatabase();
  const app: FastifyInstance = await buildApp({
    env: {
      WORKER_REGISTRATION_SECRET: REGISTRATION_SECRET,
      WORKER_HEARTBEAT_STALE_AFTER_MS: STALE_AFTER_MS,
      LOG_LEVEL: "silent" as never,
      ASSET_MAX_UPLOAD_BYTES: 1000
    },
    workerRepository: new DrizzleWorkerRepository(db),
    jobRepository: new DrizzleJobRepository(db),
    userRepository: new DrizzleUserRepository(db),
    sessionRepository: new DrizzleSessionRepository(db),
    projectRepository: new DrizzleProjectRepository(db),
    executionPlanRepository: new DrizzleExecutionPlanRepository(db),
    assetRepository: new DrizzleAssetRepository(db),
    assetStorage: new LocalFilesystemAssetStorage(mkdtempSync(join(tmpdir(), "dyo-test-assets-"))),
    workMapRepository: new DrizzleWorkMapRepository(db),
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

function manifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: "2026-08-26T00:00:00.000Z",
    compositions: [],
    scenes: [],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
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

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

describe("Work Map API", () => {
  it("rejects both routes when unauthenticated", async () => {
    const get = await harness.app.inject({ method: "GET", url: `/api/projects/${PROJECT_ID}/work-map` });
    expect(get.statusCode).toBe(401);
    const put = await harness.app.inject({ method: "PUT", url: `/api/projects/${PROJECT_ID}/work-map`, payload: { baseRevision: 0, entries: [] } });
    expect(put.statusCode).toBe(401);
  });

  it("GET returns { workMap: null } before anything has been saved - a real, valid state, never a 404", async () => {
    const response = await harness.app.inject({ method: "GET", url: `/api/projects/${PROJECT_ID}/work-map`, ...authed() });
    expect(response.statusCode).toBe(200);
    expect(response.json().workMap).toBeNull();
  });

  it("PUT creates revision 1, and GET reflects it", async () => {
    const projectId = await createProjectViaApi();
    const put = await harness.app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/work-map`,
      ...authed(),
      payload: {
        baseRevision: 0,
        entries: [
          {
            sourceCompositionId: null,
            sourceReference: "Scene 1",
            desiredAssetId: null,
            desiredText: "Hello",
            assetTimestampSeconds: null,
            desiredDurationSeconds: null,
            instructions: null
          }
        ]
      }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().workMap.revision).toBe(1);
    expect(put.json().workMap.entries).toHaveLength(1);

    const get = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/work-map`, ...authed() });
    expect(get.json().workMap.revision).toBe(1);
  });

  it("rejects a malformed entry (extra/unknown field) with 400 - strict schema", async () => {
    const projectId = await createProjectViaApi();
    const response = await harness.app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/work-map`,
      ...authed(),
      payload: { baseRevision: 0, entries: [{ notARealField: true }] }
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a stale baseRevision with 409 - never silently overwrites a newer revision", async () => {
    const projectId = await createProjectViaApi();
    await harness.app.inject({ method: "PUT", url: `/api/projects/${projectId}/work-map`, ...authed(), payload: { baseRevision: 0, entries: [] } });

    const stale = await harness.app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/work-map`,
      ...authed(),
      payload: { baseRevision: 0, entries: [] }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("CONFLICT");
  });

  it("preserves every null/unknown field exactly through a save/reload round trip", async () => {
    const projectId = await createProjectViaApi();
    await harness.app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/work-map`,
      ...authed(),
      payload: {
        baseRevision: 0,
        entries: [
          {
            sourceCompositionId: null,
            sourceReference: null,
            desiredAssetId: null,
            desiredText: null,
            assetTimestampSeconds: null,
            desiredDurationSeconds: null,
            instructions: null
          }
        ]
      }
    });

    const get = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/work-map`, ...authed() });
    expect(get.json().workMap.entries[0]).toMatchObject({
      sourceCompositionId: null,
      sourceReference: null,
      desiredAssetId: null,
      desiredText: null,
      assetTimestampSeconds: null,
      desiredDurationSeconds: null,
      instructions: null
    });
  });
});
