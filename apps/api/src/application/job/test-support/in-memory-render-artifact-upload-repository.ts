import type {
  NewRenderArtifactUploadRecord,
  RenderArtifactUploadRecord,
  RenderArtifactUploadRepository
} from "../../../domain/render-artifact-upload/types.js";

/** In-memory fake used only by unit tests - mirrors DrizzleRenderArtifactUploadRepository's find/insert/replace semantics without a real database. */
export class InMemoryRenderArtifactUploadRepository implements RenderArtifactUploadRepository {
  private readonly rows = new Map<string, RenderArtifactUploadRecord>();

  async findByJobId(jobId: string): Promise<RenderArtifactUploadRecord | null> {
    return [...this.rows.values()].find((r) => r.jobId === jobId) ?? null;
  }

  async listByProjectId(projectId: string): Promise<RenderArtifactUploadRecord[]> {
    return [...this.rows.values()].filter((r) => r.projectId === projectId);
  }

  async insert(row: NewRenderArtifactUploadRecord, now: Date): Promise<RenderArtifactUploadRecord> {
    const created: RenderArtifactUploadRecord = { ...row, createdAt: now };
    this.rows.set(created.id, created);
    return created;
  }

  async replace(id: string, row: NewRenderArtifactUploadRecord, now: Date): Promise<RenderArtifactUploadRecord> {
    const updated: RenderArtifactUploadRecord = { ...row, id, createdAt: now };
    this.rows.set(id, updated);
    return updated;
  }
}
