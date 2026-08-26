import type { ApproveExecutionPlanRequest, ExecutionPlanResponse } from "@dyo/schemas";
import {
  ExecutionPlanNotFoundError,
  ProjectNotFoundError,
  SourceShaMismatchError,
  StaleExecutionPlanRevisionError
} from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { toExecutionPlanResponse } from "./execution-plan-dto-mapper.js";

export interface ApproveExecutionPlanDeps {
  executionPlanRepository: ExecutionPlanRepository;
  projectRepository: ProjectRepository;
  now: () => Date;
}

/**
 * In-place status transition to APPROVED on the CURRENT revision - never
 * creates a new revision, since approving doesn't change content. Refuses
 * if the plan's own sourceProjectSha256 no longer matches its project's
 * current manifest sha256 (CLAUDE.md Safety Rule 8 / Phase 4: a plan
 * built for one source revision must never be approved/executed against
 * a different one that quietly replaced it).
 */
export async function approveExecutionPlan(
  deps: ApproveExecutionPlanDeps,
  projectId: string,
  userId: string,
  request: ApproveExecutionPlanRequest
): Promise<ExecutionPlanResponse> {
  const current = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (!current) {
    throw new ExecutionPlanNotFoundError(projectId);
  }
  if (current.revision !== request.baseRevision) {
    throw new StaleExecutionPlanRevisionError(request.baseRevision, current.revision);
  }

  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }
  if (project.sourceProjectSha256 !== current.sourceProjectSha256) {
    throw new SourceShaMismatchError();
  }

  const now = deps.now();
  const updated = await deps.executionPlanRepository.updateStatus(
    current.id,
    current.revision,
    { status: "APPROVED", approvedAt: now, approvedBy: userId },
    now
  );
  if (!updated) {
    throw new StaleExecutionPlanRevisionError(request.baseRevision, current.revision);
  }
  return toExecutionPlanResponse(updated);
}
