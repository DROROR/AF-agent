import type { NewSceneEvidenceRecord, SceneEvidenceRecord, SceneEvidenceRepository } from "../../../domain/scene-evidence/types.js";

/** In-memory fake used only by unit tests - mirrors DrizzleSceneEvidenceRepository's idempotent-by-jobId insert and newest-per-composition read semantics without a real database. */
export class InMemorySceneEvidenceRepository implements SceneEvidenceRepository {
  private readonly rows: SceneEvidenceRecord[] = [];

  async record(row: NewSceneEvidenceRecord, now: Date): Promise<SceneEvidenceRecord> {
    const existing = this.rows.find((r) => r.jobId === row.jobId);
    if (existing) {
      return existing;
    }
    const created: SceneEvidenceRecord = { ...row, createdAt: now };
    this.rows.push(created);
    return created;
  }

  async listCompatibleByProject(projectId: string, sourceProjectSha256: string): Promise<SceneEvidenceRecord[]> {
    return this.newestPerComposition(
      this.rows.filter((r) => r.projectId === projectId && r.sourceProjectSha256 === sourceProjectSha256)
    );
  }

  async listLatestByProject(projectId: string): Promise<SceneEvidenceRecord[]> {
    return this.newestPerComposition(this.rows.filter((r) => r.projectId === projectId));
  }

  private newestPerComposition(rows: SceneEvidenceRecord[]): SceneEvidenceRecord[] {
    const sorted = [...rows].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
    const seen = new Set<string>();
    const result: SceneEvidenceRecord[] = [];
    for (const row of sorted) {
      if (seen.has(row.manifestCompositionId)) {
        continue;
      }
      seen.add(row.manifestCompositionId);
      result.push(row);
    }
    return result;
  }
}
