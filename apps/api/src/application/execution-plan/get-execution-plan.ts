import type { ExecutionPlanResponse } from "@dyo/schemas";
import { ExecutionPlanNotFoundError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import { toExecutionPlanResponse } from "./execution-plan-dto-mapper.js";

export interface GetExecutionPlanDeps {
  executionPlanRepository: ExecutionPlanRepository;
}

export async function getExecutionPlan(deps: GetExecutionPlanDeps, projectId: string): Promise<ExecutionPlanResponse> {
  const record = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (!record) {
    throw new ExecutionPlanNotFoundError(projectId);
  }
  return toExecutionPlanResponse(record);
}
