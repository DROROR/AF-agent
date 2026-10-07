import { EXECUTION_PLAN_SCHEMA_VERSION, type ExecutionPlan, type ExecutionPlanResponse } from "@dyo/schemas";
import type { ExecutionPlanRecord } from "../../domain/execution-plan/types.js";
import { buildSceneTable } from "./build-scene-table.js";
import { validateBrandRules } from "../../domain/brand-rules/validate-brand-rules.js";
import { loadBrandRulesConfig } from "../../domain/brand-rules/brand-rules-config.js";

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
    scenePlans: record.scenePlans,
    renderOutputs: record.renderOutputs
  };
}

export function toExecutionPlanResponse(record: ExecutionPlanRecord): ExecutionPlanResponse {
  const plan = toExecutionPlan(record);
  // The approval gate's own check, read for a plan still being worked on, so
  // what is missing can be shown before approval is attempted. It decides
  // nothing here - approve-execution-plan.ts runs the gate itself.
  const config = loadBrandRulesConfig();
  const brandNeeds =
    plan.status === "DRAFT"
      ? validateBrandRules(plan, config).violations.map((violation) => ({
          rule: violation.rule,
          message: violation.message,
          requiredText: violation.rule === "REQUIRED_HEBREW_TEXT" ? config.requiredHebrewText : null
        }))
      : [];
  return { plan, sceneTable: buildSceneTable(plan.scenePlans), brandNeeds };
}
