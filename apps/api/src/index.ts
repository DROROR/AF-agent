import { createDatabase, runMigrations } from "@dyo/database";
import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";
import { DrizzleJobRepository } from "./infrastructure/db/drizzle-job-repository.js";
import { DrizzleSessionRepository } from "./infrastructure/db/drizzle-session-repository.js";
import { DrizzleUserRepository } from "./infrastructure/db/drizzle-user-repository.js";
import { DrizzleWorkerRepository } from "./infrastructure/db/drizzle-worker-repository.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const { db, pool } = createDatabase(env.DATABASE_URL);

  await runMigrations(db);

  const app = await buildApp({
    env,
    workerRepository: new DrizzleWorkerRepository(db),
    jobRepository: new DrizzleJobRepository(db),
    userRepository: new DrizzleUserRepository(db),
    sessionRepository: new DrizzleSessionRepository(db),
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
