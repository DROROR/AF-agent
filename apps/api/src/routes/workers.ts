import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { heartbeatRequestSchema, registerWorkerRequestSchema } from "@dyo/schemas";
import type { WorkerRepository } from "../domain/worker/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { UnauthorizedError } from "../errors/app-error.js";
import { extractBearerToken } from "../infrastructure/auth/bearer-token.js";
import { verifyPairingSecret } from "../infrastructure/auth/pairing-secret.js";
import { generateWorkerToken, hashToken, verifyToken } from "../infrastructure/auth/token.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { getWorker } from "../application/worker/get-worker.js";
import { listWorkers } from "../application/worker/list-workers.js";
import { recordHeartbeat } from "../application/worker/record-heartbeat.js";
import { registerWorker } from "../application/worker/register-worker.js";

export interface WorkersRouteDeps {
  repository: WorkerRepository;
  workerRegistrationSecret: string;
  staleAfterMs: number;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  now?: () => Date;
}

const workerIdParamsSchema = z.object({ workerId: z.string().uuid() });

/**
 * Every route here does exactly four things, in order: authenticate,
 * validate, call an application service, map the result to HTTP - see
 * docs/engineering/API_STANDARDS.md. No business logic lives below this file.
 */
export function registerWorkerRoutes(app: FastifyInstance, deps: WorkersRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  const sessionDeps = {
    sessionRepository: deps.sessionRepository,
    userRepository: deps.userRepository,
    verifySessionSecret,
    now
  };

  app.post("/api/workers/register", async (request, reply) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token || !verifyPairingSecret(token, deps.workerRegistrationSecret)) {
      throw new UnauthorizedError("Invalid pairing secret");
    }

    const body = registerWorkerRequestSchema.parse(request.body);
    const result = await registerWorker(
      { repository: deps.repository, generateToken: generateWorkerToken, hashToken, now },
      body
    );
    reply.status(201).send(result);
  });

  app.post("/api/workers/:workerId/heartbeat", async (request, reply) => {
    const { workerId } = workerIdParamsSchema.parse(request.params);
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedError("Missing worker token");
    }

    const body = heartbeatRequestSchema.parse(request.body);
    const dto = await recordHeartbeat(
      { repository: deps.repository, verifyToken, now },
      workerId,
      token,
      body
    );
    reply.send(dto);
  });

  /**
   * Full fleet inventory (names, statuses, capabilities, current job IDs) -
   * dashboard-only data, never reachable without a valid dashboard session
   * (CLAUDE.md: "no public worker/admin data without authentication"; see
   * also deploy/nginx/worker-api.dyocourses.com.conf, which never exposes
   * these two routes publicly in the first place - this is defense in
   * depth at the application layer too).
   */
  app.get("/api/workers", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const workers = await listWorkers({
      repository: deps.repository,
      now,
      staleAfterMs: deps.staleAfterMs
    });
    reply.send({ workers });
  });

  app.get("/api/workers/:workerId", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { workerId } = workerIdParamsSchema.parse(request.params);
    const dto = await getWorker(
      { repository: deps.repository, now, staleAfterMs: deps.staleAfterMs },
      workerId
    );
    reply.send(dto);
  });
}
