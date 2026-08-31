import type {
  FullPreviewArtifactRecord,
  FullPreviewArtifactRepository,
  NewFullPreviewArtifactRecord
} from "../../../domain/full-preview-artifact/types.js";

/** In-memory fake used only by unit tests - mirrors DrizzleFullPreviewArtifactRepository's idempotent-by-jobId insert semantics without a real database. */
export class InMemoryFullPreviewArtifactRepository implements FullPreviewArtifactRepository {
  private readonly rows: FullPreviewArtifactRecord[] = [];

  async record(row: NewFullPreviewArtifactRecord, now: Date): Promise<FullPreviewArtifactRecord> {
    const existing = this.rows.find((r) => r.jobId === row.jobId);
    if (existing) {
      return existing;
    }
    const created: FullPreviewArtifactRecord = { ...row, createdAt: now };
    this.rows.push(created);
    return created;
  }

  async findLatestForSession(executionSessionId: string): Promise<FullPreviewArtifactRecord | null> {
    const candidates = this.rows.filter((r) => r.executionSessionId === executionSessionId);
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, r) => (r.createdAt > latest.createdAt ? r : latest));
  }

  async findByIdForProject(id: string, projectId: string): Promise<FullPreviewArtifactRecord | null> {
    return this.rows.find((r) => r.id === id && r.projectId === projectId) ?? null;
  }
}
