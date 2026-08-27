import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authSessionResponseSchema } from "@dyo/schemas";
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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "./test-database.js";

const REGISTRATION_SECRET = "test-registration-secret-1234567890";
const STALE_AFTER_MS = 30_000;

/**
 * Real end-to-end coverage: real Fastify app, real (embedded) Postgres via
 * PGlite, real committed migrations, real repositories - see
 * workers.integration.test.ts for the same pattern.
 */
async function setup(initialNow: Date) {
  const { db, close } = await createTestDatabase();
  let current = initialNow;
  const app: FastifyInstance = await buildApp({
    env: {
      WORKER_REGISTRATION_SECRET: REGISTRATION_SECRET,
      WORKER_HEARTBEAT_STALE_AFTER_MS: STALE_AFTER_MS,
      LOG_LEVEL: "silent" as never,
      ASSET_MAX_UPLOAD_BYTES: 10_000_000,
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
    },
    now: () => current
  });
  return {
    app,
    close,
    advanceTime: (ms: number) => {
      current = new Date(current.getTime() + ms);
    }
  };
}

const SIGNUP_PAYLOAD = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "correct-horse",
  confirmPassword: "correct-horse"
};

let harness: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  harness = await setup(new Date("2026-01-01T00:00:00.000Z"));
});

afterAll(async () => {
  await harness?.close();
});

describe("POST /api/auth/signup", () => {
  it("creates an account and returns an active session", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: SIGNUP_PAYLOAD
    });

    expect(response.statusCode).toBe(201);
    const body = authSessionResponseSchema.parse(response.json());
    expect(body.user.email).toBe("ada@example.com");
    expect(body.user.role).toBe("OPERATOR");
  });

  it("never returns a password or passwordHash field", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: SIGNUP_PAYLOAD
    });

    const raw = response.json() as Record<string, unknown>;
    const rawUser = raw["user"] as Record<string, unknown>;
    expect(rawUser["password"]).toBeUndefined();
    expect(rawUser["passwordHash"]).toBeUndefined();
    expect(JSON.stringify(raw)).not.toContain("correct-horse");
  });

  it("rejects a second signup with the same email (409 CONFLICT)", async () => {
    await harness.app.inject({ method: "POST", url: "/api/auth/signup", payload: SIGNUP_PAYLOAD });

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { ...SIGNUP_PAYLOAD, name: "Someone Else" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CONFLICT");
  });

  it("rejects mismatched passwords with a 400 VALIDATION_ERROR", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { ...SIGNUP_PAYLOAD, confirmPassword: "different-password" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await harness.app.inject({ method: "POST", url: "/api/auth/signup", payload: SIGNUP_PAYLOAD });
  });

  it("succeeds with the correct email and password", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "ada@example.com", password: "correct-horse" }
    });

    expect(response.statusCode).toBe(200);
    const body = authSessionResponseSchema.parse(response.json());
    expect(body.user.email).toBe("ada@example.com");
  });

  it("rejects the wrong password with a generic 401", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "ada@example.com", password: "wrong-password" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
    expect(response.json().error.message).toBe("Invalid email or password");
  });

  it("rejects an unregistered email with the exact same generic 401 (no user enumeration)", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@example.com", password: "whatever123" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe("Invalid email or password");
  });

  it("never returns a password or passwordHash field", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "ada@example.com", password: "correct-horse" }
    });

    const rawUser = (response.json() as Record<string, unknown>)["user"] as Record<string, unknown>;
    expect(rawUser["password"]).toBeUndefined();
    expect(rawUser["passwordHash"]).toBeUndefined();
  });
});

describe("GET /api/auth/me", () => {
  it("returns the current user for a valid session", async () => {
    const signupResponse = await harness.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: SIGNUP_PAYLOAD
    });
    const { sessionToken } = authSessionResponseSchema.parse(signupResponse.json());

    const response = await harness.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${sessionToken}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe("ada@example.com");
  });

  it("rejects a missing session with 401", async () => {
    const response = await harness.app.inject({ method: "GET", url: "/api/auth/me" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a garbage/invalid session token with 401 (not a 500)", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: "Bearer complete-nonsense" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an expired session with 401", async () => {
    const signupResponse = await harness.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: SIGNUP_PAYLOAD
    });
    const { sessionToken } = authSessionResponseSchema.parse(signupResponse.json());

    // Signup issues a 24h session (session-ttl.ts's DEFAULT_SESSION_TTL_MS).
    harness.advanceTime(25 * 60 * 60 * 1000);

    const response = await harness.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("invalidates the session so it can no longer be used", async () => {
    const signupResponse = await harness.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: SIGNUP_PAYLOAD
    });
    const { sessionToken } = authSessionResponseSchema.parse(signupResponse.json());

    const logoutResponse = await harness.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(logoutResponse.statusCode).toBe(204);

    const meResponse = await harness.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(meResponse.statusCode).toBe(401);
  });

  it("is idempotent - logging out with no session at all still returns 204", async () => {
    const response = await harness.app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(response.statusCode).toBe(204);
  });
});
