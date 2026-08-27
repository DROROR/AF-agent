import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dispatchJobRequestSchema, reportJobCheckpointRequestSchema, reportJobStatusRequestSchema } from "@dyo/schemas";
import type { JobRepository } from "../domain/job/types.js";
import type { WorkerRepository } from "../domain/worker/types.js";
import type { ProjectRepository } from "../domain/project/types.js";
import type { SceneEvidenceRepository } from "../domain/scene-evidence/types.js";
import type { RenderArtifactRepository } from "../domain/render-artifact/types.js";
import type { RenderArtifactUploadRepository } from "../domain/render-artifact-upload/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { UnauthorizedError } from "../errors/app-error.js";
import { extractBearerToken } from "../infrastructure/auth/bearer-token.js";
import { verifyToken } from "../infrastructure/auth/token.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { claimNextJob } from "../application/job/claim-next-job.js";
import { dispatchJob } from "../application/job/dispatch-job.js";
import { reportJobStatus } from "../application/job/report-job-status.js";
import { reportJobCheckpoint } from "../application/job/report-job-checkpoint.js";
import { recordSceneEvidenceIfApplicable } from "../application/job/record-scene-evidence.js";
import { recordRenderArtifactIfApplicable } from "../application/job/record-render-artifact.js";

export interface JobsRouteDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  projectRepository: ProjectRepository;
  sceneEvidenceRepository: SceneEvidenceRepository;
  renderArtifactRepository: RenderArtifactRepository;
  renderArtifactUploadRepository: RenderArtifactUploadRepository;
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
      {
        jobRepository: deps.jobRepository,
        workerRepository: deps.workerRepository,
        projectRepository: deps.projectRepository,
        now,
        staleAfterMs: deps.staleAfterMs
      },
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
    // Best-effort side effect of a successful report - never a second,
    // competing source of truth for the job's own status/result (see
    // record-scene-evidence.ts's own doc comment), so a real failure here
    // must never make this response look like the job report itself failed.
    await recordSceneEvidenceIfApplicable({ sceneEvidenceRepository: deps.sceneEvidenceRepository, now }, dto);
    // Same "best-effort side effect, never a competing source of truth for
    // the job's own status/result" contract as recordSceneEvidenceIfApplicable
    // above - see record-render-artifact.ts's own doc comment.
    await recordRenderArtifactIfApplicable(
      { renderArtifactRepository: deps.renderArtifactRepository, renderArtifactUploadRepository: deps.renderArtifactUploadRepository, now },
      dto
    );
    reply.send(dto);
  });

  /**
   * Durable MID-JOB progress reporting - see report-job-checkpoint.ts's
   * own doc comment for why this is a separate endpoint from /report
   * rather than an overloaded status transition. Worker-bearer-token
   * authenticated, same as claim/report above - never a dashboard/session
   * endpoint, and never accepts an arbitrary/unscoped checkpoint shape
   * (validated against the specific operation's own schema at the
   * application layer).
   */
  app.post("/api/workers/:workerId/jobs/:jobId/checkpoint", async (request, reply) => {
    const { workerId, jobId } = jobParamsSchema.parse(request.params);
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedError("Missing worker token");
    }

    const body = reportJobCheckpointRequestSchema.parse(request.body);
    const dto = await reportJobCheckpoint(
      { jobRepository: deps.jobRepository, workerRepository: deps.workerRepository, verifyToken, now },
      workerId,
      jobId,
      token,
      body.checkpoint
    );
    reply.send(dto);
  });
}
