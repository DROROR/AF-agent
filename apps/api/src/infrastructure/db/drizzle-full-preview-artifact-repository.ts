import { desc, eq, and } from "drizzle-orm";
import { fullPreviewArtifacts, type Database, type FullPreviewArtifactRow } from "@dyo/database";
import type {
  FullPreviewArtifactRecord,
  FullPreviewArtifactRepository,
  NewFullPreviewArtifactRecord
} from "../../domain/full-preview-artifact/types.js";

function toDomain(row: FullPreviewArtifactRow): FullPreviewArtifactRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    executionSessionId: row.executionSessionId,
    jobId: row.jobId,
    workingProjectSha256: row.workingProjectSha256,
    filename: row.filename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    storageKey: row.storageKey,
    sha256: row.sha256,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt
  };
}

export class DrizzleFullPreviewArtifactRepository implements FullPreviewArtifactRepository {
  constructor(private readonly db: Database) {}

  async record(row: NewFullPreviewArtifactRecord, now: Date): Promise<FullPreviewArtifactRecord> {
    const [existing] = await this.db.select().from(fullPreviewArtifacts).where(eq(fullPreviewArtifacts.jobId, row.jobId));
    if (existing) {
      return toDomain(existing);
    }
    const [inserted] = await this.db
      .insert(fullPreviewArtifacts)
      .values({
        id: row.id,
        projectId: row.projectId,
        executionSessionId: row.executionSessionId,
        jobId: row.jobId,
        workingProjectSha256: row.workingProjectSha256,
        filename: row.filename,
        mimeType: row.mimeType,
        byteSize: row.byteSize,
        storageKey: row.storageKey,
        sha256: row.sha256,
        capturedAt: row.capturedAt,
        createdAt: now
      })
      .returning();
    if (!inserted) {
      throw new Error(`insert into full_preview_artifacts for job ${row.jobId} returned no row`);
    }
    return toDomain(inserted);
  }

  async findLatestForSession(executionSessionId: string): Promise<FullPreviewArtifactRecord | null> {
    const [row] = await this.db
      .select()
      .from(fullPreviewArtifacts)
      .where(eq(fullPreviewArtifacts.executionSessionId, executionSessionId))
      .orderBy(desc(fullPreviewArtifacts.createdAt))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async findByIdForProject(id: string, projectId: string): Promise<FullPreviewArtifactRecord | null> {
    const [row] = await this.db
      .select()
      .from(fullPreviewArtifacts)
      .where(and(eq(fullPreviewArtifacts.id, id), eq(fullPreviewArtifacts.projectId, projectId)));
    return row ? toDomain(row) : null;
  }
}
