import { eq } from "drizzle-orm";
import { renderArtifactUploads, type Database, type RenderArtifactUploadRow } from "@dyo/database";
import type { RenderOutputVariant } from "@dyo/schemas";
import type {
  NewRenderArtifactUploadRecord,
  RenderArtifactUploadRecord,
  RenderArtifactUploadRepository
} from "../../domain/render-artifact-upload/types.js";

function toDomain(row: RenderArtifactUploadRow): RenderArtifactUploadRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    jobId: row.jobId,
    variant: row.variant as RenderOutputVariant,
    storageKey: row.storageKey,
    sha256: row.sha256,
    byteSize: row.byteSize,
    mimeType: row.mimeType,
    createdAt: row.createdAt
  };
}

export class DrizzleRenderArtifactUploadRepository implements RenderArtifactUploadRepository {
  constructor(private readonly db: Database) {}

  async findByJobId(jobId: string): Promise<RenderArtifactUploadRecord | null> {
    const [row] = await this.db.select().from(renderArtifactUploads).where(eq(renderArtifactUploads.jobId, jobId));
    return row ? toDomain(row) : null;
  }

  async insert(row: NewRenderArtifactUploadRecord, now: Date): Promise<RenderArtifactUploadRecord> {
    const [inserted] = await this.db
      .insert(renderArtifactUploads)
      .values({
        id: row.id,
        projectId: row.projectId,
        jobId: row.jobId,
        variant: row.variant,
        storageKey: row.storageKey,
        sha256: row.sha256,
        byteSize: row.byteSize,
        mimeType: row.mimeType,
        createdAt: now
      })
      .returning();
    if (!inserted) {
      throw new Error(`insert into render_artifact_uploads for job ${row.jobId} returned no row`);
    }
    return toDomain(inserted);
  }

  async replace(id: string, row: NewRenderArtifactUploadRecord, now: Date): Promise<RenderArtifactUploadRecord> {
    const [updated] = await this.db
      .update(renderArtifactUploads)
      .set({
        storageKey: row.storageKey,
        sha256: row.sha256,
        byteSize: row.byteSize,
        mimeType: row.mimeType,
        variant: row.variant,
        createdAt: now
      })
      .where(eq(renderArtifactUploads.id, id))
      .returning();
    if (!updated) {
      throw new Error(`update of render_artifact_uploads row ${id} returned no row`);
    }
    return toDomain(updated);
  }
}
