import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dispatchJobRequestSchema, reportJobStatusRequestSchema } from "@dyo/schemas";
import type { JobRepository } from "../domain/job/types.js";
import type { WorkerRepository } from "../domain/worker/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { UnauthorizedError } from "../errors/app-error.js";
import { extractBearerToken } from "../infrastructure/auth/bearer-token.js";
import { verifyToken } from "../infrastructure/auth/token.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { claimNextJob } from "../application/job/claim-next-job.js";
import { dispatchJob } from "../application/job/dispatch-job.js";
import { reportJobStatus } from "../application/job/report-job-status.js";

export interface JobsRouteDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  staleAfterMs: number;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  now?: () => Date;
}

const workerIdParamsSchema = z.object({ workerId: z.string().uuid() });
const jobParamsSchema = z.object({ workerId: z.string().uuid(), jobId: z.string().uuid() });

/**
 * Worker job endpoints (claim/report) require the worker's own bearer
 * token - the same authenticated channel as heartbeat, never a
 * separate/weaker check. A worker can only ever see/claim/update jobs
 * addressed to its own workerId (enforced inside the application layer,
 * not just here) - see docs/JOB-DISPATCH.md.
 *
 * POST /api/jobs (below) is the one dashboard-facing route here, and uses
 * the opposite auth model - a dashboard session, never a worker token
 * (CLAUDE.md: "Dashboard user auth and Worker token auth are separate
 * systems"). No role check beyond "authenticated dashboard user" is
 * applied: no route anywhere in this app currently restricts by
 * ADMIN/OPERATOR role, so adding one here would invent enforcement that
 * doesn't exist yet rather than reuse something established.
 */
export function registerJobRoutes(app: FastifyInstance, deps: JobsRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  const sessionDeps = {
    sessionRepository: deps.sessionRepository,
    userRepository: deps.userRepository,
    verifySessionSecret,
    now
  };

  /**
   * The only production-safe way to create a job. Supports exactly one
   * operation (INSPECT_TEMPLATE - see @dyo/schemas' DISPATCHABLE_OPERATIONS)
   * and is never a generic "execute anything" endpoint. All worker-state
   * safety gates (fresh heartbeat, AE/MCP online, capability present, not
   * busy, no duplicate live inspection) live in dispatch-job.ts, not here.
   */
  app.post("/api/jobs", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const body = dispatchJobRequestSchema.parse(request.body);
    const dto = await dispatchJob(
      { jobRepository: deps.jobRepository, workerRepository: deps.workerRepository, now, staleAfterMs: deps.staleAfterMs },
      body
    );
    reply.status(201).send(dto);
  });

  app.post("/api/workers/:workerId/jobs/claim", async (request, reply) => {
    const { workerId } = workerIdParamsSchema.parse(request.params);
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedError("Missing worker token");
    }

    const job = await claimNextJob(
      { jobRepository: deps.jobRepository, workerRepository: deps.workerRepository, verifyToken, now, staleAfterMs: deps.staleAfterMs },
      workerId,
      token
    );
    reply.send({ job });
  });

  app.post("/api/workers/:workerId/jobs/:jobId/report", async (request, reply) => {
    const { workerId, jobId } = jobParamsSchema.parse(request.params);
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedError("Missing worker token");
    }

    const body = reportJobStatusRequestSchema.parse(request.body);
    const dto = await reportJobStatus(
      { jobRepository: deps.jobRepository, workerRepository: deps.workerRepository, verifyToken, now },
      workerId,
      jobId,
      token,
      body
    );
    reply.send(dto);
  });
}
