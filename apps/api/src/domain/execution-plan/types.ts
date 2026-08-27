import type { PlanStatus, RenderOutputConfig, RenderOutputVariant, RenderOutputs, ScenePlanEntry } from "@dyo/schemas";

export interface ExecutionPlanRecord {
  id: string;
  projectId: string;
  revision: number;
  status: PlanStatus;
  templateId: string;
  sourceProjectSha256: string;
  scenePlans: ScenePlanEntry[];
  renderOutputs: RenderOutputs;
  /** The most recently successfully-completed EXECUTE_FRAME job's own working-copy identity - see schema.ts's own doc comment on this column. Null until at least one EXECUTE_FRAME job has ever succeeded for this plan. */
  workingProjectPath: string | null;
  workingProjectSha256: string | null;
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
  /** Every persisted revision for this project (append-only history), ordered newest-first. Read-only - dashboard revision history view. */
  findAllByProjectId(projectId: string): Promise<ExecutionPlanRecord[]>;
  /**
   * In-place update of ONE variant's render output config on the CURRENT
   * revision - never bumps revision or touches status/scenePlans (setting
   * a render delivery target is not scene CONTENT requiring re-approval -
   * see render-delivery phase section 1). `config: null` clears that
   * variant's configuration. Returns null only if `id` doesn't exist.
   */
  updateRenderOutput(id: string, variant: RenderOutputVariant, config: RenderOutputConfig | null, now: Date): Promise<ExecutionPlanRecord | null>;
  /**
   * In-place update of the plan's own durably-tracked working-copy
   * identity, called only from record-execute-frame-result.ts after a
   * REAL EXECUTE_FRAME job succeeds - never bumps revision/status/
   * scenePlans, same "delivery/derived state, not scene content" rationale
   * as updateRenderOutput. Returns null only if `id` doesn't exist.
   */
  updateWorkingCopy(id: string, workingProjectPath: string, workingProjectSha256: string, now: Date): Promise<ExecutionPlanRecord | null>;
}
