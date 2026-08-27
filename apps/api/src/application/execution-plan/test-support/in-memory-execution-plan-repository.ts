import { EMPTY_RENDER_OUTPUTS, type RenderOutputConfig, type RenderOutputVariant } from "@dyo/schemas";
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
      renderOutputs: EMPTY_RENDER_OUTPUTS,
      workingProjectPath: null,
      workingProjectSha256: null,
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

  async findAllByProjectId(projectId: string): Promise<ExecutionPlanRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => b.revision - a.revision);
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

  async updateRenderOutput(
    id: string,
    variant: RenderOutputVariant,
    config: RenderOutputConfig | null,
    now: Date
  ): Promise<ExecutionPlanRecord | null> {
    const existing = this.rows.get(id);
    if (!existing) {
      return null;
    }
    const updated: ExecutionPlanRecord = {
      ...existing,
      renderOutputs: { ...existing.renderOutputs, [variant]: config },
      updatedAt: now
    };
    this.rows.set(id, updated);
    return updated;
  }

  async updateWorkingCopy(id: string, workingProjectPath: string, workingProjectSha256: string, now: Date): Promise<ExecutionPlanRecord | null> {
    const existing = this.rows.get(id);
    if (!existing) {
      return null;
    }
    const updated: ExecutionPlanRecord = { ...existing, workingProjectPath, workingProjectSha256, updatedAt: now };
    this.rows.set(id, updated);
    return updated;
  }
}
