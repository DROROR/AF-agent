import Fastify, { type FastifyInstance } from "fastify";
import type { Env } from "./env.js";
import type { WorkerRepository } from "./domain/worker/types.js";
import { registerErrorHandler } from "./errors/error-handler-plugin.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerWorkerRoutes } from "./routes/workers.js";

export interface AppDependencies {
  env: Pick<Env, "WORKER_REGISTRATION_SECRET" | "WORKER_HEARTBEAT_STALE_AFTER_MS" | "LOG_LEVEL">;
  workerRepository: WorkerRepository;
  checkDatabaseHealth: () => Promise<boolean>;
  now?: () => Date;
}

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: {
      level: deps.env.LOG_LEVEL,
      redact: ["req.headers.authorization"]
    }
  });

  registerErrorHandler(app);
  registerHealthRoutes(app, { checkDatabaseHealth: deps.checkDatabaseHealth });
  registerWorkerRoutes(app, {
    repository: deps.workerRepository,
    workerRegistrationSecret: deps.env.WORKER_REGISTRATION_SECRET,
    staleAfterMs: deps.env.WORKER_HEARTBEAT_STALE_AFTER_MS,
    ...(deps.now ? { now: deps.now } : {})
  });

  return app;
}
