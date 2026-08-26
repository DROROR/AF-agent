import { randomUUID } from "node:crypto";
import type { ExecutionPlanResponse, UpdateExecutionPlanRequest } from "@dyo/schemas";
import { ExecutionPlanEditError, ExecutionPlanNotFoundError, StaleExecutionPlanRevisionError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import { applyExecutionPlanEdit } from "./apply-execution-plan-edit.js";
import { toExecutionPlanResponse } from "./execution-plan-dto-mapper.js";

export interface UpdateExecutionPlanDeps {
  executionPlanRepository: ExecutionPlanRepository;
  now: () => Date;
}

/**
 * Applies one or more typed edit operations as a single new revision.
 * Never mutates in place (execution_plans is append-only for content -
 * see packages/database/src/schema.ts). Always resets status to DRAFT on
 * the new revision, even if the plan was APPROVED/REJECTED before this
 * edit - Phase 4's own hard rule: "Do not allow an edited plan to remain
 * silently APPROVED."
 */
export async function updateExecutionPlan(
  deps: UpdateExecutionPlanDeps,
  projectId: string,
  request: UpdateExecutionPlanRequest
): Promise<ExecutionPlanResponse> {
  const current = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (!current) {
    throw new ExecutionPlanNotFoundError(projectId);
  }
  if (current.revision !== request.baseRevision) {
    throw new StaleExecutionPlanRevisionError(request.baseRevision, current.revision);
  }

  let scenePlans = current.scenePlans;
  for (const operation of request.operations) {
    const result = applyExecutionPlanEdit(scenePlans, operation, deps.now);
    if (!result.ok) {
      throw new ExecutionPlanEditError(result.reason);
    }
    scenePlans = result.scenePlans;
  }

  const record = await deps.executionPlanRepository.createRevision(
    {
      id: randomUUID(),
      projectId,
      revision: current.revision + 1,
      status: "DRAFT",
      templateId: current.templateId,
      sourceProjectSha256: current.sourceProjectSha256,
      scenePlans,
      approvedAt: null,
      approvedBy: null
    },
    deps.now()
  );

  return toExecutionPlanResponse(record);
}
