import type { ExecutionSessionStatus } from "@dyo/schemas";
import type { ExecutionSessionRecord, ExecutionSessionRepository, NewExecutionSession } from "../../../domain/execution-session/types.js";

/** In-memory fake used only by unit tests - never imported from production code. Mirrors DrizzleExecutionSessionRepository's own semantics (idempotent recordSceneCompleted, in-place status/preview updates). */
export class InMemoryExecutionSessionRepository implements ExecutionSessionRepository {
  private readonly rows = new Map<string, ExecutionSessionRecord>();

  async create(session: NewExecutionSession, now: Date): Promise<ExecutionSessionRecord> {
    const row: ExecutionSessionRecord = {
      id: session.id,
      projectId: session.projectId,
      executionPlanId: session.executionPlanId,
      planRevision: session.planRevision,
      sourceProjectSha256: session.sourceProjectSha256,
      assignedWorkerId: session.assignedWorkerId,
      status: "PREPARING",
      latestWorkingProjectSha256: null,
      completedScenePlanIds: [],
      firstPreviewApproved: false,
      latestPreviewStorageKey: null,
      latestPreviewSha256: null,
      latestPreviewScenePlanId: null,
      latestPreviewCapturedAt: null,
      fullPreviewApproved: false,
      createdAt: now,
      updatedAt: now
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findById(id: string): Promise<ExecutionSessionRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async findLatestByProjectId(projectId: string): Promise<ExecutionSessionRecord | null> {
    const candidates = [...this.rows.values()].filter((r) => r.projectId === projectId);
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, r) => (r.createdAt > latest.createdAt ? r : latest));
  }

  async listByProjectId(projectId: string): Promise<ExecutionSessionRecord[]> {
    return [...this.rows.values()].filter((r) => r.projectId === projectId);
  }

  async recordSceneCompleted(
    id: string,
    scenePlanId: string,
    workingProjectSha256: string,
    status: ExecutionSessionStatus,
    now: Date
  ): Promise<ExecutionSessionRecord | null> {
    const existing = this.rows.get(id);
    if (!existing) {
      return null;
    }
    const nextCompleted = existing.completedScenePlanIds.includes(scenePlanId)
      ? existing.completedScenePlanIds
      : [...existing.completedScenePlanIds, scenePlanId];
    const updated: ExecutionSessionRecord = {
      ...existing,
      completedScenePlanIds: nextCompleted,
      latestWorkingProjectSha256: workingProjectSha256,
      status,
      updatedAt: now
    };
    this.rows.set(id, updated);
    return updated;
  }

  async approvePreview(id: string, status: ExecutionSessionStatus, now: Date): Promise<ExecutionSessionRecord | null> {
    const existing = this.rows.get(id);
    if (!existing) {
      return null;
    }
    const updated: ExecutionSessionRecord = { ...existing, firstPreviewApproved: true, status, updatedAt: now };
    this.rows.set(id, updated);
    return updated;
  }

  async markStatus(id: string, status: ExecutionSessionStatus, now: Date): Promise<ExecutionSessionRecord | null> {
    const existing = this.rows.get(id);
    if (!existing) {
      return null;
    }
    const updated: ExecutionSessionRecord = { ...existing, status, updatedAt: now };
    this.rows.set(id, updated);
    return updated;
  }

  async recordPreview(
    id: string,
    preview: { storageKey: string; sha256: string; scenePlanId: string; capturedAt: Date },
    now: Date
  ): Promise<{ record: ExecutionSessionRecord; priorStorageKey: string | null } | null> {
    const existing = this.rows.get(id);
    if (!existing) {
      return null;
    }
    const priorStorageKey = existing.latestPreviewStorageKey;
    const updated: ExecutionSessionRecord = {
      ...existing,
      latestPreviewStorageKey: preview.storageKey,
      latestPreviewSha256: preview.sha256,
      latestPreviewScenePlanId: preview.scenePlanId,
      latestPreviewCapturedAt: preview.capturedAt,
      updatedAt: now
    };
    this.rows.set(id, updated);
    return { record: updated, priorStorageKey };
  }

  async setFullPreviewApproved(id: string, approved: boolean, now: Date): Promise<ExecutionSessionRecord | null> {
    const existing = this.rows.get(id);
    if (!existing) {
      return null;
    }
    const updated: ExecutionSessionRecord = { ...existing, fullPreviewApproved: approved, updatedAt: now };
    this.rows.set(id, updated);
    return updated;
  }
}
