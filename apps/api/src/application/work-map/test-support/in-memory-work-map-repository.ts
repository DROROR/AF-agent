import type { NewWorkMapRevision, WorkMapRecord, WorkMapRepository } from "../../../domain/work-map/types.js";

/** In-memory fake used only by unit tests - never imported from production code. */
export class InMemoryWorkMapRepository implements WorkMapRepository {
  private readonly rows = new Map<string, WorkMapRecord>();

  async createRevision(revisionRow: NewWorkMapRevision, now: Date): Promise<WorkMapRecord> {
    const row: WorkMapRecord = { ...revisionRow, createdAt: now, updatedAt: now };
    this.rows.set(row.id, row);
    return row;
  }

  async findCurrentByProjectId(projectId: string): Promise<WorkMapRecord | null> {
    const candidates = [...this.rows.values()].filter((r) => r.projectId === projectId);
    if (candidates.length === 0) return null;
    return candidates.reduce((max, r) => (r.revision > max.revision ? r : max));
  }
}
