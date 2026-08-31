import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  approveExecutionPlanRequestSchema,
  createExecutionPlanRequestSchema,
  createProjectRequestSchema,
  rejectExecutionPlanRequestSchema,
  renderOutputVariantSchema,
  reopenExecutionPlanRequestSchema,
  setRenderOutputConfigRequestSchema,
  updateExecutionPlanRequestSchema,
  updateProjectBrandInputsRequestSchema
} from "@dyo/schemas";
import type { ExecutionPlanRepository } from "../domain/execution-plan/types.js";
import type { ProjectRepository } from "../domain/project/types.js";
import type { AssetRepository } from "../domain/asset/types.js";
import type { AssetStorage } from "../domain/asset-storage/types.js";
import type { ExecutionSessionRepository } from "../domain/execution-session/types.js";
import type { JobRepository } from "../domain/job/types.js";
import type { RenderArtifactRepository } from "../domain/render-artifact/types.js";
import type { RenderArtifactUploadRepository } from "../domain/render-artifact-upload/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { createProject } from "../application/project/create-project.js";
import { getProject } from "../application/project/get-project.js";
import { listProjects } from "../application/project/list-projects.js";
import { updateBrandInputs } from "../application/project/update-brand-inputs.js";
import { deleteProject } from "../application/project/delete-project.js";
import { createExecutionPlan } from "../application/execution-plan/create-execution-plan.js";
import { getExecutionPlan } from "../application/execution-plan/get-execution-plan.js";
import { listExecutionPlanRevisions } from "../application/execution-plan/list-execution-plan-revisions.js";
import { updateExecutionPlan } from "../application/execution-plan/update-execution-plan.js";
import { approveExecutionPlan } from "../application/execution-plan/approve-execution-plan.js";
import { rejectExecutionPlan } from "../application/execution-plan/reject-execution-plan.js";
import { reopenExecutionPlan } from "../application/execution-plan/reopen-execution-plan.js";
import { setRenderOutputConfig } from "../application/execution-plan/set-render-output-config.js";
import type { BrandRulesConfig } from "../domain/brand-rules/validate-brand-rules.js";

export interface ProjectsRouteDeps {
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  assetRepository: AssetRepository;
  assetStorage: AssetStorage;
  jobRepository: JobRepository;
  executionSessionRepository: ExecutionSessionRepository;
  renderArtifactRepository: RenderArtifactRepository;
  renderArtifactUploadRepository: RenderArtifactUploadRepository;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  now?: () => Date;
  /** Injectable for tests - defaults to reading the real dyo-brand-rules.yaml (see approve-execution-plan.ts). */
  brandRulesConfig?: BrandRulesConfig;
}

const projectIdParamsSchema = z.object({ projectId: z.string().uuid() });
const renderOutputParamsSchema = z.object({ projectId: z.string().uuid(), variant: renderOutputVariantSchema });

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

  /**
   * Offline-safe-control-plane phase, section 1 ("Add Delete Project") -
   * see delete-project.ts's own doc comment for the full safety contract
   * (refuses while an active job exists, deletes owned storage before the
   * DB row, never touches the Windows worker's own filesystem). 204: a
   * real DELETE with no body to return, same convention as every other
   * successful DELETE in this API.
   */
  app.delete("/api/projects/:projectId", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    await deleteProject(
      {
        projectRepository: deps.projectRepository,
        jobRepository: deps.jobRepository,
        assetRepository: deps.assetRepository,
        assetStorage: deps.assetStorage,
        executionSessionRepository: deps.executionSessionRepository,
        renderArtifactRepository: deps.renderArtifactRepository,
        renderArtifactUploadRepository: deps.renderArtifactUploadRepository
      },
      projectId
    );
    reply.status(204).send();
  });

  /** Replaces the client's whole brand-inputs object - input only, never DYO's own permanent brand rules (see project.ts's doc comment) and never executed in After Effects by this phase. */
  app.patch("/api/projects/:projectId/brand-inputs", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = updateProjectBrandInputsRequestSchema.parse(request.body);
    const result = await updateBrandInputs({ projectRepository: deps.projectRepository, now }, projectId, body);
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

  /** Read-only revision history for the dashboard's Revisions tab - see list-execution-plan-revisions.ts. */
  app.get("/api/projects/:projectId/execution-plan/revisions", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const result = await listExecutionPlanRevisions({ executionPlanRepository: deps.executionPlanRepository }, projectId);
    reply.send(result);
  });

  app.patch("/api/projects/:projectId/execution-plan", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = updateExecutionPlanRequestSchema.parse(request.body);
    const result = await updateExecutionPlan(
      { executionPlanRepository: deps.executionPlanRepository, assetRepository: deps.assetRepository, now },
      projectId,
      body
    );
    reply.send(result);
  });

  app.post("/api/projects/:projectId/execution-plan/approve", async (request, reply) => {
    const user = await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = approveExecutionPlanRequestSchema.parse(request.body);
    const result = await approveExecutionPlan(
      {
        executionPlanRepository: deps.executionPlanRepository,
        projectRepository: deps.projectRepository,
        now,
        ...(deps.brandRulesConfig ? { brandRulesConfig: deps.brandRulesConfig } : {})
      },
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

  /**
   * Explicit render-output configuration (render-delivery phase section
   * 1/2/3) - see set-render-output-config.ts for the full contract
   * (server-resolved composition identity, source-SHA staleness check).
   */
  app.put("/api/projects/:projectId/execution-plan/render-outputs/:variant", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId, variant } = renderOutputParamsSchema.parse(request.params);
    const body = setRenderOutputConfigRequestSchema.parse(request.body);
    const result = await setRenderOutputConfig(
      { executionPlanRepository: deps.executionPlanRepository, projectRepository: deps.projectRepository, now },
      projectId,
      variant,
      body
    );
    reply.send(result);
  });
}
