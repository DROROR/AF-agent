import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { Env } from "./env.js";
import type { JobRepository } from "./domain/job/types.js";
import type { WorkerRepository } from "./domain/worker/types.js";
import type { SessionRepository, UserRepository } from "./domain/auth/types.js";
import { registerErrorHandler } from "./errors/error-handler-plugin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerWorkerRoutes } from "./routes/workers.js";

export interface AppDependencies {
  env: Pick<Env, "WORKER_REGISTRATION_SECRET" | "WORKER_HEARTBEAT_STALE_AFTER_MS" | "LOG_LEVEL">;
  workerRepository: WorkerRepository;
  jobRepository: JobRepository;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  checkDatabaseHealth: () => Promise<boolean>;
  now?: () => Date;
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.env.LOG_LEVEL,
      // Covers both worker bearer tokens and dashboard session tokens - the
      // same header carries either, and neither may ever reach the logs
      // (CLAUDE.md: "no password/token logging"). Request bodies (which is
      // where a signup/login password lives) are never logged by Fastify's
      // default logger in the first place.
      redact: ["req.headers.authorization"]
    }
  });

  // global: false - only routes that opt in via `config: { rateLimit }`
  // (POST /api/auth/login, /api/auth/signup) are limited; every other
  // route is unaffected.
  await app.register(rateLimit, { global: false });

  registerErrorHandler(app);
  registerHealthRoutes(app, { checkDatabaseHealth: deps.checkDatabaseHealth });
  registerAuthRoutes(app, {
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerWorkerRoutes(app, {
    repository: deps.workerRepository,
    workerRegistrationSecret: deps.env.WORKER_REGISTRATION_SECRET,
    staleAfterMs: deps.env.WORKER_HEARTBEAT_STALE_AFTER_MS,
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerJobRoutes(app, {
    jobRepository: deps.jobRepository,
    workerRepository: deps.workerRepository,
    staleAfterMs: deps.env.WORKER_HEARTBEAT_STALE_AFTER_MS,
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    ...(deps.now ? { now: deps.now } : {})
  });

  return app;
}
