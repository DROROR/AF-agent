import { randomUUID } from "node:crypto";
import type { ExecutionPlanResponse } from "@dyo/schemas";
import { ExecutionPlanAlreadyExistsError, ProjectNotFoundError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { buildScenePlans } from "./build-execution-plan.js";
import { toExecutionPlanResponse } from "./execution-plan-dto-mapper.js";

export interface CreateExecutionPlanDeps {
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  now: () => Date;
}

/**
 * Creates the initial DRAFT execution plan (revision 1) for a project,
 * deterministically built from its current manifest. Refuses (rather than
 * silently resetting) if one already exists - GET/update are the paths
 * for an already-planned project.
 */
export async function createExecutionPlan(deps: CreateExecutionPlanDeps, projectId: string): Promise<ExecutionPlanResponse> {
  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  const existing = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (existing) {
    throw new ExecutionPlanAlreadyExistsError(projectId);
  }

  const now = deps.now();
  const scenePlans = buildScenePlans(project.manifest, deps.now);
  const record = await deps.executionPlanRepository.createRevision(
    {
      id: randomUUID(),
      projectId,
      revision: 1,
      status: "DRAFT",
      templateId: project.templateId,
      sourceProjectSha256: project.sourceProjectSha256,
      scenePlans,
      approvedAt: null,
      approvedBy: null
    },
    now
  );

  return toExecutionPlanResponse(record);
}
