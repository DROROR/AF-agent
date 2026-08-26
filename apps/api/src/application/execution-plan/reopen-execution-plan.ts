import type { ExecutionPlanResponse, ReopenExecutionPlanRequest } from "@dyo/schemas";
import { ExecutionPlanNotFoundError, StaleExecutionPlanRevisionError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import { toExecutionPlanResponse } from "./execution-plan-dto-mapper.js";

export interface ReopenExecutionPlanDeps {
  executionPlanRepository: ExecutionPlanRepository;
  now: () => Date;
}

/** Explicit human decision to return an APPROVED/REJECTED plan to DRAFT so editing can resume - never automatic. Content is unchanged. */
export async function reopenExecutionPlan(
  deps: ReopenExecutionPlanDeps,
  projectId: string,
  request: ReopenExecutionPlanRequest
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
    { status: "DRAFT", approvedAt: null, approvedBy: null },
    deps.now()
  );
  if (!updated) {
    throw new StaleExecutionPlanRevisionError(request.baseRevision, current.revision);
  }
  return toExecutionPlanResponse(updated);
}
