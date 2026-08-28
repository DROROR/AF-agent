import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createExecutionSessionRequestSchema } from "@dyo/schemas";
import type { ExecutionSessionRepository } from "../domain/execution-session/types.js";
import type { ExecutionPlanRepository } from "../domain/execution-plan/types.js";
import type { ProjectRepository } from "../domain/project/types.js";
import type { WorkerRepository } from "../domain/worker/types.js";
import type { JobRepository } from "../domain/job/types.js";
import type { AssetStorage } from "../domain/asset-storage/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { createExecutionSession } from "../application/execution-session/create-execution-session.js";
import { getCurrentExecutionSession } from "../application/execution-session/get-current-execution-session.js";
import { approveFirstPreview } from "../application/execution-session/approve-first-preview.js";
import { rejectFirstPreview } from "../application/execution-session/reject-first-preview.js";
import { getPreviewFile } from "../application/execution-session/get-preview-file.js";

export interface ExecutionSessionsRouteDeps {
  executionSessionRepository: ExecutionSessionRepository;
  executionPlanRepository: ExecutionPlanRepository;
  projectRepository: ProjectRepository;
  workerRepository: WorkerRepository;
  jobRepository: JobRepository;
  assetStorage: AssetStorage;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  staleAfterMs: number;
  now?: () => Date;
}

const projectIdParamsSchema = z.object({ projectId: z.string().uuid() });
const sessionParamsSchema = z.object({ projectId: z.string().uuid(), sessionId: z.string().uuid() });

/**
 * PROJECT EXECUTION SESSION control-plane routes (multi-scene-accumulation
 * phase, section 14) - dashboard-session authenticated, same as
 * routes/projects.ts, never a worker bearer token. Every route here only
 * ever identifies project/scene intent (never a Windows path, never a
 * working-copy identity) - see create-execution-session.ts/
 * get-current-execution-session.ts/approve-first-preview.ts for what each
 * actually resolves server-side.
 */
export function registerExecutionSessionRoutes(app: FastifyInstance, deps: ExecutionSessionsRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  const sessionDeps = {
    sessionRepository: deps.sessionRepository,
    userRepository: deps.userRepository,
    verifySessionSecret,
    now
  };

  app.post("/api/projects/:projectId/execution-sessions", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = createExecutionSessionRequestSchema.parse(request.body);
    const session = await createExecutionSession(
      {
        executionSessionRepository: deps.executionSessionRepository,
        executionPlanRepository: deps.executionPlanRepository,
        projectRepository: deps.projectRepository,
        workerRepository: deps.workerRepository,
        now,
        staleAfterMs: deps.staleAfterMs
      },
      projectId,
      body.workerId
    );
    reply.status(201).send({ session });
  });

  app.get("/api/projects/:projectId/execution-sessions/current", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const result = await getCurrentExecutionSession(
      {
        executionSessionRepository: deps.executionSessionRepository,
        executionPlanRepository: deps.executionPlanRepository,
        workerRepository: deps.workerRepository,
        jobRepository: deps.jobRepository,
        now,
        staleAfterMs: deps.staleAfterMs
      },
      projectId
    );
    reply.send(result);
  });

  app.post("/api/projects/:projectId/execution-sessions/:sessionId/approve-preview", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId, sessionId } = sessionParamsSchema.parse(request.params);
    const session = await approveFirstPreview(
      { executionSessionRepository: deps.executionSessionRepository, executionPlanRepository: deps.executionPlanRepository, now },
      projectId,
      sessionId
    );
    reply.send({ session });
  });

  app.post("/api/projects/:projectId/execution-sessions/:sessionId/reject-preview", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId, sessionId } = sessionParamsSchema.parse(request.params);
    const session = await rejectFirstPreview({ executionSessionRepository: deps.executionSessionRepository, now }, projectId, sessionId);
    reply.send({ session });
  });

  /**
   * Streams the real preview bytes back - never exposes a storage key or
   * filesystem path in the response (section 3). Requires BOTH projectId
   * and sessionId to match a real persisted, project-owned session; a
   * cross-project sessionId guess is refused identically to one that
   * doesn't exist at all (see get-preview-file.ts).
   */
  app.get("/api/projects/:projectId/execution-sessions/:sessionId/preview", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId, sessionId } = sessionParamsSchema.parse(request.params);
    const file = await getPreviewFile({ executionSessionRepository: deps.executionSessionRepository, assetStorage: deps.assetStorage }, projectId, sessionId);
    reply.header("content-type", file.mimeType);
    reply.send(file.buffer);
  });
}
