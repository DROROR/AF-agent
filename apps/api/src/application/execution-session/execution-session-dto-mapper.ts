import type { ExecutionSessionDto, ExecutionSessionStatus } from "@dyo/schemas";
import type { ExecutionSessionRecord } from "../../domain/execution-session/types.js";

export function toExecutionSessionDto(record: ExecutionSessionRecord, displayStatus?: ExecutionSessionStatus): ExecutionSessionDto {
  return {
    id: record.id,
    projectId: record.projectId,
    executionPlanId: record.executionPlanId,
    planRevision: record.planRevision,
    sourceProjectSha256: record.sourceProjectSha256,
    assignedWorkerId: record.assignedWorkerId,
    status: displayStatus ?? record.status,
    latestWorkingProjectSha256: record.latestWorkingProjectSha256,
    completedScenePlanIds: record.completedScenePlanIds,
    firstPreviewApproved: record.firstPreviewApproved,
    hasPreview: record.latestPreviewStorageKey !== null,
    latestPreviewScenePlanId: record.latestPreviewScenePlanId,
    latestPreviewCapturedAt: record.latestPreviewCapturedAt ? record.latestPreviewCapturedAt.toISOString() : null,
    fullPreviewApproved: record.fullPreviewApproved,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}
