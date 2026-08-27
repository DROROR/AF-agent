import type { NewRenderArtifactRecord, RenderArtifactRecord, RenderArtifactRepository } from "../../../domain/render-artifact/types.js";

/** In-memory fake used only by unit tests - mirrors DrizzleRenderArtifactRepository's idempotent-by-jobId insert semantics without a real database. */
export class InMemoryRenderArtifactRepository implements RenderArtifactRepository {
  private readonly rows: RenderArtifactRecord[] = [];

  async record(row: NewRenderArtifactRecord, now: Date): Promise<RenderArtifactRecord> {
    const existing = this.rows.find((r) => r.jobId === row.jobId);
    if (existing) {
      return existing;
    }
    const created: RenderArtifactRecord = { ...row, validationStatus: "VALID", createdAt: now };
    this.rows.push(created);
    return created;
  }

  async listByProject(projectId: string): Promise<RenderArtifactRecord[]> {
    return this.rows
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findByIdForProject(id: string, projectId: string): Promise<RenderArtifactRecord | null> {
    return this.rows.find((r) => r.id === id && r.projectId === projectId) ?? null;
  }
}
