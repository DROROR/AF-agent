import type { PlanStatus, ScenePlanEntry } from "@dyo/schemas";

export interface ExecutionPlanRecord {
  id: string;
  projectId: string;
  revision: number;
  status: PlanStatus;
  templateId: string;
  sourceProjectSha256: string;
  scenePlans: ScenePlanEntry[];
  approvedAt: Date | null;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewExecutionPlanRevision {
  id: string;
  projectId: string;
  revision: number;
  status: PlanStatus;
  templateId: string;
  sourceProjectSha256: string;
  scenePlans: ScenePlanEntry[];
  approvedAt: Date | null;
  approvedBy: string | null;
}

export interface ExecutionPlanStatusUpdate {
  status: PlanStatus;
  approvedAt: Date | null;
  approvedBy: string | null;
}

/**
 * Port the application layer depends on. `execution_plans` is append-only
 * for content (createRevision never overwrites a prior row - see
 * packages/database/src/schema.ts's own doc comment on the table);
 * updateStatus is the one narrow exception, an in-place transition that
 * never touches scenePlans/revision (approve/reject/reopen change status
 * only, not content).
 */
export interface ExecutionPlanRepository {
  createRevision(row: NewExecutionPlanRevision, now: Date): Promise<ExecutionPlanRecord>;
  findCurrentByProjectId(projectId: string): Promise<ExecutionPlanRecord | null>;
  /**
   * Applies only if `id`'s current revision still equals `expectedRevision`
   * (optimistic concurrency - "stale plan revision rejected"). Returns null
   * if the row doesn't exist or the revision has already moved on.
   */
  updateStatus(id: string, expectedRevision: number, update: ExecutionPlanStatusUpdate, now: Date): Promise<ExecutionPlanRecord | null>;
}
