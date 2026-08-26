import type { ExecutionPlanRevisionSummary, ListExecutionPlanRevisionsResponse } from "@dyo/schemas";
import { ExecutionPlanNotFoundError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";

export interface ListExecutionPlanRevisionsDeps {
  executionPlanRepository: ExecutionPlanRepository;
}

/** Read-only revision-history summary - see execution-plan-api.ts's executionPlanRevisionSummarySchema doc comment for why this never carries full scenePlans. */
export async function listExecutionPlanRevisions(
  deps: ListExecutionPlanRevisionsDeps,
  projectId: string
): Promise<ListExecutionPlanRevisionsResponse> {
  const records = await deps.executionPlanRepository.findAllByProjectId(projectId);
  if (records.length === 0) {
    throw new ExecutionPlanNotFoundError(projectId);
  }
  const currentRevision = Math.max(...records.map((r) => r.revision));
  const revisions: ExecutionPlanRevisionSummary[] = records
    .slice()
    .sort((a, b) => b.revision - a.revision)
    .map((record) => ({
      revision: record.revision,
      status: record.status,
      sceneCount: record.scenePlans.length,
      approvedAt: record.approvedAt ? record.approvedAt.toISOString() : null,
      approvedBy: record.approvedBy,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      isCurrent: record.revision === currentRevision
    }));
  return { revisions };
}
