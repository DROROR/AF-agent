import type {
  ExecutionPlanRecord,
  ExecutionPlanRepository,
  ExecutionPlanStatusUpdate,
  NewExecutionPlanRevision
} from "../../../domain/execution-plan/types.js";

/** In-memory fake used only by unit tests - never imported from production code. Mirrors DrizzleExecutionPlanRepository's append-only-content / in-place-status-update semantics. */
export class InMemoryExecutionPlanRepository implements ExecutionPlanRepository {
  private readonly rows = new Map<string, ExecutionPlanRecord>();

  async createRevision(revisionRow: NewExecutionPlanRevision, now: Date): Promise<ExecutionPlanRecord> {
    const row: ExecutionPlanRecord = {
      id: revisionRow.id,
      projectId: revisionRow.projectId,
      revision: revisionRow.revision,
      status: revisionRow.status,
      templateId: revisionRow.templateId,
      sourceProjectSha256: revisionRow.sourceProjectSha256,
      scenePlans: revisionRow.scenePlans,
      approvedAt: revisionRow.approvedAt,
      approvedBy: revisionRow.approvedBy,
      createdAt: now,
      updatedAt: now
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findCurrentByProjectId(projectId: string): Promise<ExecutionPlanRecord | null> {
    const candidates = [...this.rows.values()].filter((r) => r.projectId === projectId);
    if (candidates.length === 0) return null;
    return candidates.reduce((max, r) => (r.revision > max.revision ? r : max));
  }

  async updateStatus(
    id: string,
    expectedRevision: number,
    update: ExecutionPlanStatusUpdate,
    now: Date
  ): Promise<ExecutionPlanRecord | null> {
    const existing = this.rows.get(id);
    if (!existing || existing.revision !== expectedRevision) {
      return null;
    }
    const updated: ExecutionPlanRecord = {
      ...existing,
      status: update.status,
      approvedAt: update.approvedAt,
      approvedBy: update.approvedBy,
      updatedAt: now
    };
    this.rows.set(id, updated);
    return updated;
  }
}
