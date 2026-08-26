import { getExecutionPlanReadiness, type ApproveExecutionPlanRequest, type ExecutionPlanResponse } from "@dyo/schemas";
import {
  ExecutionPlanNotFoundError,
  PreconditionNotMetError,
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
 * if:
 *   - the caller's baseRevision is stale (optimistic concurrency),
 *   - the plan isn't currently DRAFT (only a DRAFT plan is eligible -
 *     REJECTED must be reopened first, and re-"approving" an already
 *     APPROVED plan is refused rather than silently overwriting
 *     approvedAt/approvedBy),
 *   - the plan's own sourceProjectSha256 no longer matches its project's
 *     current manifest sha256 (CLAUDE.md Safety Rule 8 / Phase 4: a plan
 *     built for one source revision must never be approved/executed
 *     against a different one that quietly replaced it),
 *   - any scene marked for use still has an unresolved reason
 *     (getExecutionPlanReadiness - the SAME shared predicate the
 *     dashboard's Overview tab uses, so the UI can never claim a plan is
 *     ready when this would actually refuse it).
 * This is real backend enforcement, not merely a disabled UI button - a
 * direct API call cannot bypass it.
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
  if (current.status !== "DRAFT") {
    throw new PreconditionNotMetError(`Plan is ${current.status}, not DRAFT - only a DRAFT plan is eligible for approval`);
  }

  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }
  if (project.sourceProjectSha256 !== current.sourceProjectSha256) {
    throw new SourceShaMismatchError();
  }

  const readiness = getExecutionPlanReadiness(current.scenePlans);
  if (!readiness.ready) {
    throw new PreconditionNotMetError(
      `Plan is not ready for approval: ${readiness.unresolvedSceneCount} scene(s) marked for use still have an unresolved reason`
    );
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
