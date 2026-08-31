import type {
  SceneEvidencePreviewRecord,
  SceneEvidencePreviewRepository,
  NewSceneEvidencePreviewRecord
} from "../types.js";

/** In-memory fake used only by unit tests - mirrors DrizzleSceneEvidencePreviewRepository's idempotent-by-jobId insert semantics without a real database. */
export class InMemorySceneEvidencePreviewRepository implements SceneEvidencePreviewRepository {
  private readonly rows: SceneEvidencePreviewRecord[] = [];

  async record(row: NewSceneEvidencePreviewRecord, now: Date): Promise<SceneEvidencePreviewRecord> {
    const existing = this.rows.find((r) => r.jobId === row.jobId);
    if (existing) {
      return existing;
    }
    const created: SceneEvidencePreviewRecord = { ...row, createdAt: now };
    this.rows.push(created);
    return created;
  }

  async findLatestForComposition(projectId: string, manifestCompositionId: string): Promise<SceneEvidencePreviewRecord | null> {
    const candidates = this.rows.filter((r) => r.projectId === projectId && r.manifestCompositionId === manifestCompositionId);
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, r) => (r.createdAt > latest.createdAt ? r : latest));
  }

  async findByIdForProject(id: string, projectId: string): Promise<SceneEvidencePreviewRecord | null> {
    return this.rows.find((r) => r.id === id && r.projectId === projectId) ?? null;
  }
}
