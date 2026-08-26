import type { ExecutionPlanResponse, RejectExecutionPlanRequest } from "@dyo/schemas";
import { ExecutionPlanNotFoundError, StaleExecutionPlanRevisionError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import { toExecutionPlanResponse } from "./execution-plan-dto-mapper.js";

export interface RejectExecutionPlanDeps {
  executionPlanRepository: ExecutionPlanRepository;
  now: () => Date;
}

/** In-place status transition to REJECTED on the current revision - content is unchanged, only its review status. */
export async function rejectExecutionPlan(
  deps: RejectExecutionPlanDeps,
  projectId: string,
  request: RejectExecutionPlanRequest
): Promise<ExecutionPlanResponse> {
  const current = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (!current) {
    throw new ExecutionPlanNotFoundError(projectId);
  }
  if (current.revision !== request.baseRevision) {
    throw new StaleExecutionPlanRevisionError(request.baseRevision, current.revision);
  }

  const updated = await deps.executionPlanRepository.updateStatus(
    current.id,
    current.revision,
    { status: "REJECTED", approvedAt: null, approvedBy: null },
    deps.now()
  );
  if (!updated) {
    throw new StaleExecutionPlanRevisionError(request.baseRevision, current.revision);
  }
  return toExecutionPlanResponse(updated);
}
