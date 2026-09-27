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
  /**
   * What this revision starts with - REQUIRED, never defaulted by the
   * repository. Until 2026-09-27 the repositories hardcoded
   * EMPTY_RENDER_OUTPUTS here, which silently destroyed a configured
   * render output whenever any unrelated plan edit created a revision
   * (see carry-forward-render-outputs.ts for the real incident). Making
   * it a field of the row lets the caller say what the new revision starts
   * with: revision 1 has nothing to inherit, a superseding revision passes
   * carryForwardRenderOutputs(...) of the revision it supersedes.
   *
   * Optional, defaulting to EMPTY_RENDER_OUTPUTS, because a brand-new plan
   * genuinely inherits nothing and every test fixture builds one from
   * scratch. The guarantee that matters is pinned by a test on the real
   * caller (update-execution-plan), not by the compiler: an omitted field
   * here means "starts with nothing", which is the honest default, while
   * silently DISCARDING what a previous revision held is the bug.
   */
  renderOutputs?: RenderOutputs;
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
   * In-place update of the CURRENT revision's own scenePlans, same
   * revision - never bumps revision or touches status (mapping-review
   * propagation fix: a readiness-only correction, e.g.
   * reconcile-execution-plan-readiness.ts, is never a content edit).
   * Optimistic concurrency identical to updateStatus. Returns null if the
   * row doesn't exist or the revision has already moved on.
   */
  updateSceneReadiness(id: string, expectedRevision: number, scenePlans: ScenePlanEntry[], now: Date): Promise<ExecutionPlanRecord | null>;
}
