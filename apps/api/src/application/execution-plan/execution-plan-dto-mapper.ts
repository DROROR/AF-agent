import { EXECUTION_PLAN_SCHEMA_VERSION, type ExecutionPlan, type ExecutionPlanResponse } from "@dyo/schemas";
import type { ExecutionPlanRecord } from "../../domain/execution-plan/types.js";
import { buildSceneTable } from "./build-scene-table.js";

export function toExecutionPlan(record: ExecutionPlanRecord): ExecutionPlan {
  return {
    schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
    id: record.id,
    projectId: record.projectId,
    revision: record.revision,
    status: record.status,
    templateId: record.templateId,
    sourceProjectSha256: record.sourceProjectSha256,
    approvedAt: record.approvedAt ? record.approvedAt.toISOString() : null,
    approvedBy: record.approvedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    scenePlans: record.scenePlans
  };
}

export function toExecutionPlanResponse(record: ExecutionPlanRecord): ExecutionPlanResponse {
  const plan = toExecutionPlan(record);
  return { plan, sceneTable: buildSceneTable(plan.scenePlans) };
}
