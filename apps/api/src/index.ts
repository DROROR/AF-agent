import { createDatabase, runMigrations } from "@dyo/database";
import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";
import { assertManagedRuntime } from "./production-runtime-guard.js";
import { DrizzleJobRepository } from "./infrastructure/db/drizzle-job-repository.js";
import { DrizzleSessionRepository } from "./infrastructure/db/drizzle-session-repository.js";
import { DrizzleUserRepository } from "./infrastructure/db/drizzle-user-repository.js";
import { DrizzleWorkerRepository } from "./infrastructure/db/drizzle-worker-repository.js";
import { DrizzleProjectRepository } from "./infrastructure/db/drizzle-project-repository.js";
import { DrizzleExecutionPlanRepository } from "./infrastructure/db/drizzle-execution-plan-repository.js";
import { DrizzleAssetRepository } from "./infrastructure/db/drizzle-asset-repository.js";
import { DrizzleWorkMapRepository } from "./infrastructure/db/drizzle-work-map-repository.js";
import { DrizzleMappingSuggestionRepository } from "./infrastructure/db/drizzle-mapping-suggestion-repository.js";
import { DrizzleSceneEvidenceRepository } from "./infrastructure/db/drizzle-scene-evidence-repository.js";
import { DrizzleRenderArtifactRepository } from "./infrastructure/db/drizzle-render-artifact-repository.js";
import { DrizzleRenderArtifactUploadRepository } from "./infrastructure/db/drizzle-render-artifact-upload-repository.js";
import { DrizzleExecutionSessionRepository } from "./infrastructure/db/drizzle-execution-session-repository.js";
import { NotConfiguredAiSuggestionProvider } from "./application/mapping-assistant/ai-suggestion-provider.js";
import { LocalFilesystemAssetStorage } from "./infrastructure/storage/local-filesystem-asset-storage.js";

async function main(): Promise<void> {
  const env = loadEnv();
  assertManagedRuntime(env, process.env["pm_id"]);
  const { db, pool } = createDatabase(env.DATABASE_URL);

  await runMigrations(db);

  const app = await buildApp({
    env,
    workerRepository: new DrizzleWorkerRepository(db),
    jobRepository: new DrizzleJobRepository(db),
    userRepository: new DrizzleUserRepository(db),
    sessionRepository: new DrizzleSessionRepository(db),
    projectRepository: new DrizzleProjectRepository(db),
    executionPlanRepository: new DrizzleExecutionPlanRepository(db),
    assetRepository: new DrizzleAssetRepository(db),
    assetStorage: new LocalFilesystemAssetStorage(env.ASSET_STORAGE_ROOT),
    workMapRepository: new DrizzleWorkMapRepository(db),
    mappingSuggestionRepository: new DrizzleMappingSuggestionRepository(db),
    sceneEvidenceRepository: new DrizzleSceneEvidenceRepository(db),
    renderArtifactRepository: new DrizzleRenderArtifactRepository(db),
    renderArtifactUploadRepository: new DrizzleRenderArtifactUploadRepository(db),
    executionSessionRepository: new DrizzleExecutionSessionRepository(db),
    // No real AI provider is integrated yet (mapping-assistant phase section 5/15) - deterministic
    // matching remains fully functional; the dashboard reports AI as unavailable via aiAvailable: false.
    aiSuggestionProvider: new NotConfiguredAiSuggestionProvider(),
    checkDatabaseHealth: async () => {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    }
  });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await pool.end();
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
}

main().catch((error: unknown) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
