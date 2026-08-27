import { and, desc, eq } from "drizzle-orm";
import { renderArtifacts, type Database, type RenderArtifactRow } from "@dyo/database";
import type { RenderOutputVariant } from "@dyo/schemas";
import type { NewRenderArtifactRecord, RenderArtifactRecord, RenderArtifactRepository } from "../../domain/render-artifact/types.js";

function toDomain(row: RenderArtifactRow): RenderArtifactRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    jobId: row.jobId,
    variant: row.variant as RenderOutputVariant,
    compositionName: row.compositionName,
    workingProjectSha256: row.workingProjectSha256,
    filename: row.filename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    storageKey: row.storageKey,
    sha256: row.sha256,
    renderStartedAt: row.renderStartedAt,
    renderCompletedAt: row.renderCompletedAt,
    aerenderExitCode: row.aerenderExitCode,
    logExcerpt: row.logExcerpt,
    validationStatus: "VALID",
    createdAt: row.createdAt
  };
}

export class DrizzleRenderArtifactRepository implements RenderArtifactRepository {
  constructor(private readonly db: Database) {}

  async record(row: NewRenderArtifactRecord, now: Date): Promise<RenderArtifactRecord> {
    const [inserted] = await this.db
      .insert(renderArtifacts)
      .values({
        id: row.id,
        projectId: row.projectId,
        jobId: row.jobId,
        variant: row.variant,
        compositionName: row.compositionName,
        workingProjectSha256: row.workingProjectSha256,
        filename: row.filename,
        mimeType: row.mimeType,
        byteSize: row.byteSize,
        storageKey: row.storageKey,
        sha256: row.sha256,
        renderStartedAt: row.renderStartedAt,
        renderCompletedAt: row.renderCompletedAt,
        aerenderExitCode: row.aerenderExitCode,
        logExcerpt: row.logExcerpt,
        validationStatus: "VALID",
        createdAt: now
      })
      .onConflictDoNothing({ target: renderArtifacts.jobId })
      .returning();

    if (inserted) {
      return toDomain(inserted);
    }

    // A row already exists for this jobId (duplicate/retried callback) -
    // return the existing record rather than erroring, matching
    // DrizzleSceneEvidenceRepository's own idempotent-by-jobId contract.
    const [existing] = await this.db.select().from(renderArtifacts).where(eq(renderArtifacts.jobId, row.jobId));
    if (!existing) {
      throw new Error(`render_artifacts insert for job ${row.jobId} conflicted, but no existing row was found`);
    }
    return toDomain(existing);
  }

  async listByProject(projectId: string): Promise<RenderArtifactRecord[]> {
    const rows = await this.db
      .select()
      .from(renderArtifacts)
      .where(eq(renderArtifacts.projectId, projectId))
      .orderBy(desc(renderArtifacts.createdAt));
    return rows.map(toDomain);
  }

  async findByIdForProject(id: string, projectId: string): Promise<RenderArtifactRecord | null> {
    const [row] = await this.db
      .select()
      .from(renderArtifacts)
      .where(and(eq(renderArtifacts.id, id), eq(renderArtifacts.projectId, projectId)));
    return row ? toDomain(row) : null;
  }
}
