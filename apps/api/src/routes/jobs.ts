import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { reportJobStatusRequestSchema } from "@dyo/schemas";
import type { JobRepository } from "../domain/job/types.js";
import type { WorkerRepository } from "../domain/worker/types.js";
import { UnauthorizedError } from "../errors/app-error.js";
import { extractBearerToken } from "../infrastructure/auth/bearer-token.js";
import { verifyToken } from "../infrastructure/auth/token.js";
import { claimNextJob } from "../application/job/claim-next-job.js";
import { reportJobStatus } from "../application/job/report-job-status.js";

export interface JobsRouteDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  staleAfterMs: number;
  now?: () => Date;
}

const workerIdParamsSchema = z.object({ workerId: z.string().uuid() });
const jobParamsSchema = z.object({ workerId: z.string().uuid(), jobId: z.string().uuid() });

/**
 * Every worker job endpoint requires the worker's own bearer token - the
 * same authenticated channel as heartbeat, never a separate/weaker check.
 * A worker can only ever see/claim/update jobs addressed to its own
 * workerId (enforced inside the application layer, not just here) - see
 * docs/JOB-DISPATCH.md.
 */
export function registerJobRoutes(app: FastifyInstance, deps: JobsRouteDeps): void {
  const now = deps.now ?? (() => new Date());

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
