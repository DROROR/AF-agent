import { beforeEach, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SCHEMA_VERSION, authSessionResponseSchema, type TemplateManifest } from "@dyo/schemas";
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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "./test-database.js";

const REGISTRATION_SECRET = "test-registration-secret-1234567890";
const STALE_AFTER_MS = 30_000;

function manifest(sha256 = "a".repeat(64)): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256 },
    afterEffects: { version: "26.3x87" },
    generatedAt: "2026-08-26T00:00:00.000Z",
    compositions: [
      { compositionId: "comp-1", name: "Scene A", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
    ],
    scenes: [
      {
        sceneId: "scene-a",
        displayName: null,
        compositionId: "comp-1",
        originalOrderIndex: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
        // A real, resolved (non-"unknown") placeholder - so this scene has
        // no unresolvedReasons by default and approve succeeds in the
        // tests below that expect it to. See the dedicated
        // "unresolved plan" approval-rejection tests further down for the
        // opposite case.
        placeholders: [
          {
            placeholderId: "ph-1",
            displayLabel: null,
            compositionId: "comp-1",
            layerName: "Headline",
            layerIndex: 1,
            layerPath: [],
            placeholderType: "text",
            editable: true,
            sourceType: "TextLayer",
            dimensions: null,
            startTimeSeconds: 0,
            durationSeconds: 5,
            evidence: { source: "read_directly", reason: "TextLayer confirmed via ae_get_composition" }
          }
        ]
      }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

async function setup(initialNow: Date) {
  const { db, close } = await createTestDatabase();
  let current = initialNow;
  const app: FastifyInstance = await buildApp({
    env: { WORKER_REGISTRATION_SECRET: REGISTRATION_SECRET, WORKER_HEARTBEAT_STALE_AFTER_MS: STALE_AFTER_MS, LOG_LEVEL: "silent" as never, ASSET_MAX_UPLOAD_BYTES: 10_000_000 },
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
    },
    now: () => current
  });
  return { app, close, advanceTime: (ms: number) => { current = new Date(current.getTime() + ms); } };
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
  harness = await setup(new Date("2026-01-01T00:00:00.000Z"));
  sessionToken = await signUpAndGetSessionToken(harness.app);
});

afterAll(async () => {
  await harness?.close();
});

function authed(token = sessionToken) {
  return token ? { headers: { authorization: `Bearer ${token}` } } : {};
}

async function createProjectViaApi(manifestOverride: TemplateManifest = manifest()): Promise<string> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/projects",
    ...authed(),
    payload: { name: "Test Project", manifest: manifestOverride }
  });
  return response.json().projectId;
}

/** No placeholders at all - build-execution-plan.ts's real logic leaves this scene's unresolvedReasons non-empty, matching the real White App Promo plan's current state. */
function unresolvedManifest(): TemplateManifest {
  const base = manifest();
  return { ...base, scenes: base.scenes.map((scene) => ({ ...scene, placeholders: [] })) };
}

describe("POST /api/projects", () => {
  it("rejects an unauthenticated request", async () => {
    const response = await harness.app.inject({ method: "POST", url: "/api/projects", payload: { name: "x", manifest: manifest() } });
    expect(response.statusCode).toBe(401);
  });

  it("creates a project from a valid manifest", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/projects",
      ...authed(),
      payload: { name: "Test Project", manifest: manifest() }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().templateId).toBe("tmpl-1");
    expect(response.json().sourceProjectSha256).toBe("a".repeat(64));
  });

  it("rejects an invalid manifest payload", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/projects",
      ...authed(),
      payload: { name: "Test Project", manifest: { not: "a real manifest" } }
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/projects and /api/projects/:projectId", () => {
  it("lists a created project", async () => {
    await createProjectViaApi();
    const response = await harness.app.inject({ method: "GET", url: "/api/projects", ...authed() });
    expect(response.json().projects).toHaveLength(1);
  });

  it("returns 404 for an unknown project", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/projects/00000000-0000-0000-0000-000000000000",
      ...authed()
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("rejects an unauthenticated GET", async () => {
    const response = await harness.app.inject({ method: "GET", url: "/api/projects" });
    expect(response.statusCode).toBe(401);
  });
});

describe("execution plan API", () => {
  it("rejects an unauthenticated create/get/update/approve", async () => {
    const projectId = await createProjectViaApi();
    const paths = [
      { method: "POST" as const, url: `/api/projects/${projectId}/execution-plan` },
      { method: "GET" as const, url: `/api/projects/${projectId}/execution-plan` },
      { method: "PATCH" as const, url: `/api/projects/${projectId}/execution-plan` },
      { method: "POST" as const, url: `/api/projects/${projectId}/execution-plan/approve` }
    ];
    for (const p of paths) {
      const response = await harness.app.inject({ method: p.method, url: p.url });
      expect(response.statusCode).toBe(401);
    }
  });

  it("creates a DRAFT plan (revision 1) from the project's manifest", async () => {
    const projectId = await createProjectViaApi();
    const response = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.plan.status).toBe("DRAFT");
    expect(body.plan.revision).toBe(1);
    expect(body.plan.scenePlans).toHaveLength(1);
    expect(body.sceneTable).toHaveLength(1);
  });

  it("refuses to create a second plan for the same project", async () => {
    const projectId = await createProjectViaApi();
    await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    const second = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    expect(second.statusCode).toBe(409);
  });

  it("GET returns the current plan", async () => {
    const projectId = await createProjectViaApi();
    await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    const response = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    expect(response.statusCode).toBe(200);
    expect(response.json().plan.revision).toBe(1);
  });

  it("rejects an arbitrary/unsupported edit operation type", async () => {
    const projectId = await createProjectViaApi();
    await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    const response = await harness.app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/execution-plan`,
      ...authed(),
      payload: { baseRevision: 1, operations: [{ type: "RUN_ARBITRARY_JSX", script: "app.quit()" }] }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("applies a valid edit and bumps the revision", async () => {
    const projectId = await createProjectViaApi();
    const created = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    const sceneId = created.json().plan.scenePlans[0].id;

    const response = await harness.app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/execution-plan`,
      ...authed(),
      payload: { baseRevision: 1, operations: [{ type: "EXCLUDE_SCENE", scenePlanId: sceneId }] }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().plan.revision).toBe(2);
    expect(response.json().plan.scenePlans[0].use).toBe(false);
  });

  it("rejects a stale baseRevision on update", async () => {
    const projectId = await createProjectViaApi();
    const created = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    const sceneId = created.json().plan.scenePlans[0].id;

    const response = await harness.app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/execution-plan`,
      ...authed(),
      payload: { baseRevision: 99, operations: [{ type: "EXCLUDE_SCENE", scenePlanId: sceneId }] }
    });
    expect(response.statusCode).toBe(409);
  });

  it("approve/reject/reopen transition status without changing revision, and never touch worker/job tables", async () => {
    const projectId = await createProjectViaApi();
    await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });

    const approved = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/execution-plan/approve`,
      ...authed(),
      payload: { baseRevision: 1 }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().plan.status).toBe("APPROVED");
    expect(approved.json().plan.revision).toBe(1);

    const rejected = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/execution-plan/reject`,
      ...authed(),
      payload: { baseRevision: 1 }
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().plan.status).toBe("REJECTED");

    const reopened = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/execution-plan/reopen`,
      ...authed(),
      payload: { baseRevision: 1 }
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().plan.status).toBe("DRAFT");

    // No worker was ever registered/dispatched to in this whole test - the
    // execution-plan API never reaches worker/job routes.
    const workersResponse = await harness.app.inject({ method: "GET", url: "/api/workers", ...authed() });
    expect(workersResponse.json().workers).toEqual([]);
  });

  it("an edit after APPROVED resets status to DRAFT - never silently stays approved", async () => {
    const projectId = await createProjectViaApi();
    const created = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    const sceneId = created.json().plan.scenePlans[0].id;
    await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/execution-plan/approve`,
      ...authed(),
      payload: { baseRevision: 1 }
    });

    const response = await harness.app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/execution-plan`,
      ...authed(),
      payload: { baseRevision: 1, operations: [{ type: "EXCLUDE_SCENE", scenePlanId: sceneId }] }
    });
    expect(response.json().plan.status).toBe("DRAFT");
    expect(response.json().plan.revision).toBe(2);
  });

  it("rejects an unauthenticated revision-history request", async () => {
    const projectId = await createProjectViaApi();
    await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    const response = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/execution-plan/revisions` });
    expect(response.statusCode).toBe(401);
  });

  it("returns 404 for revision history when no plan exists yet", async () => {
    const projectId = await createProjectViaApi();
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/execution-plan/revisions`,
      ...authed()
    });
    expect(response.statusCode).toBe(404);
  });

  it("lists every real persisted revision, newest first, with exactly one marked current", async () => {
    const projectId = await createProjectViaApi();
    const created = await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    const sceneId = created.json().plan.scenePlans[0].id;
    await harness.app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/execution-plan`,
      ...authed(),
      payload: { baseRevision: 1, operations: [{ type: "EXCLUDE_SCENE", scenePlanId: sceneId }] }
    });

    const response = await harness.app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/execution-plan/revisions`,
      ...authed()
    });
    expect(response.statusCode).toBe(200);
    const revisions = response.json().revisions;
    expect(revisions).toHaveLength(2);
    expect(revisions.map((r: { revision: number }) => r.revision)).toEqual([2, 1]);
    expect(revisions[0]).toMatchObject({ revision: 2, status: "DRAFT", isCurrent: true, sceneCount: 1 });
    expect(revisions[1]).toMatchObject({ revision: 1, isCurrent: false });
    // Never the full scenePlans payload for every past revision.
    expect(revisions[0]).not.toHaveProperty("scenePlans");
  });

  it("rejects a direct API approval of a real unresolved plan with 409 PRECONDITION_NOT_MET - a UI restriction alone cannot be bypassed by calling the API directly", async () => {
    const projectId = await createProjectViaApi(unresolvedManifest());
    await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/execution-plan/approve`,
      ...authed(),
      payload: { baseRevision: 1 }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PRECONDITION_NOT_MET");

    // The plan must remain exactly DRAFT/revision 1 - never partially approved.
    const stillDraft = await harness.app.inject({ method: "GET", url: `/api/projects/${projectId}/execution-plan`, ...authed() });
    expect(stillDraft.json().plan.status).toBe("DRAFT");
    expect(stillDraft.json().plan.revision).toBe(1);
    expect(stillDraft.json().plan.approvedAt).toBeNull();
  });

  it("allows approval once the plan is genuinely resolved (real success path, not just the rejection path)", async () => {
    const projectId = await createProjectViaApi();
    await harness.app.inject({ method: "POST", url: `/api/projects/${projectId}/execution-plan`, ...authed() });

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/execution-plan/approve`,
      ...authed(),
      payload: { baseRevision: 1 }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().plan.status).toBe("APPROVED");
  });
});
