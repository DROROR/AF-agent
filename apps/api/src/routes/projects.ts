import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  approveExecutionPlanRequestSchema,
  createExecutionPlanRequestSchema,
  createProjectRequestSchema,
  rejectExecutionPlanRequestSchema,
  reopenExecutionPlanRequestSchema,
  updateExecutionPlanRequestSchema
} from "@dyo/schemas";
import type { ExecutionPlanRepository } from "../domain/execution-plan/types.js";
import type { ProjectRepository } from "../domain/project/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { createProject } from "../application/project/create-project.js";
import { getProject } from "../application/project/get-project.js";
import { listProjects } from "../application/project/list-projects.js";
import { createExecutionPlan } from "../application/execution-plan/create-execution-plan.js";
import { getExecutionPlan } from "../application/execution-plan/get-execution-plan.js";
import { updateExecutionPlan } from "../application/execution-plan/update-execution-plan.js";
import { approveExecutionPlan } from "../application/execution-plan/approve-execution-plan.js";
import { rejectExecutionPlan } from "../application/execution-plan/reject-execution-plan.js";
import { reopenExecutionPlan } from "../application/execution-plan/reopen-execution-plan.js";

export interface ProjectsRouteDeps {
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  now?: () => Date;
}

const projectIdParamsSchema = z.object({ projectId: z.string().uuid() });

/**
 * Phase 4 (docs/PHASES.md: "Dynamic Approval Table + Execution Plan") -
 * control-plane planning only. Every route here requires an authenticated
 * dashboard session, same as routes/jobs.ts's POST /api/jobs - never a
 * worker bearer token, and nothing here ever reaches the Windows worker
 * or ae-mcp. No AE mutation, save, render, or arbitrary JSX is reachable
 * from any handler in this file.
 */
export function registerProjectRoutes(app: FastifyInstance, deps: ProjectsRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  const sessionDeps = {
    sessionRepository: deps.sessionRepository,
    userRepository: deps.userRepository,
    verifySessionSecret,
    now
  };

  app.post("/api/projects", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const body = createProjectRequestSchema.parse(request.body);
    const project = await createProject({ projectRepository: deps.projectRepository, now }, body);
    reply.status(201).send(project);
  });

  app.get("/api/projects", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const result = await listProjects({ projectRepository: deps.projectRepository });
    reply.send(result);
  });

  app.get("/api/projects/:projectId", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const result = await getProject({ projectRepository: deps.projectRepository }, projectId);
    reply.send(result);
  });

  app.post("/api/projects/:projectId/execution-plan", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    createExecutionPlanRequestSchema.parse(request.body ?? {});
    const result = await createExecutionPlan(
      { projectRepository: deps.projectRepository, executionPlanRepository: deps.executionPlanRepository, now },
      projectId
    );
    reply.status(201).send(result);
  });

  app.get("/api/projects/:projectId/execution-plan", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const result = await getExecutionPlan({ executionPlanRepository: deps.executionPlanRepository }, projectId);
    reply.send(result);
  });

  app.patch("/api/projects/:projectId/execution-plan", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = updateExecutionPlanRequestSchema.parse(request.body);
    const result = await updateExecutionPlan({ executionPlanRepository: deps.executionPlanRepository, now }, projectId, body);
    reply.send(result);
  });

  app.post("/api/projects/:projectId/execution-plan/approve", async (request, reply) => {
    const user = await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = approveExecutionPlanRequestSchema.parse(request.body);
    const result = await approveExecutionPlan(
      { executionPlanRepository: deps.executionPlanRepository, projectRepository: deps.projectRepository, now },
      projectId,
      user.id,
      body
    );
    reply.send(result);
  });

  app.post("/api/projects/:projectId/execution-plan/reject", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = rejectExecutionPlanRequestSchema.parse(request.body);
    const result = await rejectExecutionPlan({ executionPlanRepository: deps.executionPlanRepository, now }, projectId, body);
    reply.send(result);
  });

  app.post("/api/projects/:projectId/execution-plan/reopen", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = reopenExecutionPlanRequestSchema.parse(request.body);
    const result = await reopenExecutionPlan({ executionPlanRepository: deps.executionPlanRepository, now }, projectId, body);
    reply.send(result);
  });
}
