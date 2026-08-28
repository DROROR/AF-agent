import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dispatchJobRequestSchema, reportJobCheckpointRequestSchema, reportJobStatusRequestSchema } from "@dyo/schemas";
import type { JobRepository } from "../domain/job/types.js";
import type { WorkerRepository } from "../domain/worker/types.js";
import type { ProjectRepository } from "../domain/project/types.js";
import type { SceneEvidenceRepository } from "../domain/scene-evidence/types.js";
import type { RenderArtifactRepository } from "../domain/render-artifact/types.js";
import type { RenderArtifactUploadRepository } from "../domain/render-artifact-upload/types.js";
import type { AssetRepository } from "../domain/asset/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { UnauthorizedError } from "../errors/app-error.js";
import { extractBearerToken } from "../infrastructure/auth/bearer-token.js";
import { verifyToken } from "../infrastructure/auth/token.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { claimNextJob } from "../application/job/claim-next-job.js";
import { dispatchJob } from "../application/job/dispatch-job.js";
import { getJobForUser } from "../application/job/get-job-for-user.js";
import { reportJobStatus } from "../application/job/report-job-status.js";
import { reportJobCheckpoint } from "../application/job/report-job-checkpoint.js";
import { recordSceneEvidenceIfApplicable } from "../application/job/record-scene-evidence.js";
import { recordRenderArtifactIfApplicable } from "../application/job/record-render-artifact.js";
import { recordExecuteFrameResultIfApplicable } from "../application/job/record-execute-frame-result.js";
import type { ExecutionPlanRepository } from "../domain/execution-plan/types.js";
import type { ExecutionSessionRepository } from "../domain/execution-session/types.js";

export interface JobsRouteDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  executionSessionRepository: ExecutionSessionRepository;
  assetRepository: AssetRepository;
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
const jobIdParamsSchema = z.object({ jobId: z.string().uuid() });

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
    const user = await requireSessionUser(request.headers.authorization, sessionDeps);
    const body = dispatchJobRequestSchema.parse(request.body);
    const dto = await dispatchJob(
      {
        jobRepository: deps.jobRepository,
        workerRepository: deps.workerRepository,
        projectRepository: deps.projectRepository,
        executionPlanRepository: deps.executionPlanRepository,
        executionSessionRepository: deps.executionSessionRepository,
        assetRepository: deps.assetRepository,
        now,
        staleAfterMs: deps.staleAfterMs
      },
      body,
      user.id
    );
    reply.status(201).send(dto);
  });

  /**
   * The one dashboard-facing read of a job's own status/result - see
   * get-job-for-user.ts for the ownership rule this enforces (only the
   * user who dispatched it, via createdByUserId - never a worker's
   * credentials, and never any other dashboard user). Primarily for
   * polling an INSPECT_TEMPLATE/INSPECT_RENDER_CAPABILITIES job that has
   * no project yet to scope access through.
   */
  app.get("/api/jobs/:jobId", async (request, reply) => {
    const user = await requireSessionUser(request.headers.authorization, sessionDeps);
    const { jobId } = jobIdParamsSchema.parse(request.params);
    const job = await getJobForUser({ jobRepository: deps.jobRepository }, user.id, jobId);
    reply.send({ job });
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
      {
        renderArtifactRepository: deps.renderArtifactRepository,
        renderArtifactUploadRepository: deps.renderArtifactUploadRepository,
        executionSessionRepository: deps.executionSessionRepository,
        now
      },
      dto
    );
    // Same "best-effort side effect" contract - see record-execute-frame-result.ts's own doc comment.
    await recordExecuteFrameResultIfApplicable(
      { executionSessionRepository: deps.executionSessionRepository, executionPlanRepository: deps.executionPlanRepository, now },
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
