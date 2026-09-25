import { desc, eq, and, isNull } from "drizzle-orm";
import { sceneEvidencePreviews, type Database, type SceneEvidencePreviewRow } from "@dyo/database";
import type {
  SceneEvidencePreviewRecord,
  SceneEvidencePreviewRepository,
  NewSceneEvidencePreviewRecord
} from "../../domain/scene-evidence-preview/types.js";

function toDomain(row: SceneEvidencePreviewRow): SceneEvidencePreviewRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    jobId: row.jobId,
    manifestCompositionId: row.manifestCompositionId,
    sourceProjectSha256: row.sourceProjectSha256,
    filename: row.filename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    storageKey: row.storageKey,
    sha256: row.sha256,
    capturedAt: row.capturedAt,
    capturedAtSeconds: row.capturedAtSeconds,
    slotMappingId: row.slotMappingId,
    createdAt: row.createdAt
  };
}

export class DrizzleSceneEvidencePreviewRepository implements SceneEvidencePreviewRepository {
  constructor(private readonly db: Database) {}

  async record(row: NewSceneEvidencePreviewRecord, now: Date): Promise<SceneEvidencePreviewRecord> {
    const [existing] = await this.db.select().from(sceneEvidencePreviews).where(eq(sceneEvidencePreviews.jobId, row.jobId));
    if (existing) {
      return toDomain(existing);
    }
    const [inserted] = await this.db
      .insert(sceneEvidencePreviews)
      .values({
        id: row.id,
        projectId: row.projectId,
        jobId: row.jobId,
        manifestCompositionId: row.manifestCompositionId,
        sourceProjectSha256: row.sourceProjectSha256,
        filename: row.filename,
        mimeType: row.mimeType,
        byteSize: row.byteSize,
        storageKey: row.storageKey,
        sha256: row.sha256,
        capturedAt: row.capturedAt,
        capturedAtSeconds: row.capturedAtSeconds,
        slotMappingId: row.slotMappingId,
        createdAt: now
      })
      .returning();
    if (!inserted) {
      throw new Error(`insert into scene_evidence_previews for job ${row.jobId} returned no row`);
    }
    return toDomain(inserted);
  }

  async findLatestForComposition(projectId: string, manifestCompositionId: string): Promise<SceneEvidencePreviewRecord | null> {
    const [row] = await this.db
      .select()
      .from(sceneEvidencePreviews)
      .where(and(eq(sceneEvidencePreviews.projectId, projectId), eq(sceneEvidencePreviews.manifestCompositionId, manifestCompositionId)))
      .orderBy(desc(sceneEvidencePreviews.createdAt))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async findLatestForSlot(projectId: string, manifestCompositionId: string, slotMappingId: string): Promise<SceneEvidencePreviewRecord | null> {
    const [attributed] = await this.db
      .select()
      .from(sceneEvidencePreviews)
      .where(
        and(
          eq(sceneEvidencePreviews.projectId, projectId),
          eq(sceneEvidencePreviews.manifestCompositionId, manifestCompositionId),
          eq(sceneEvidencePreviews.slotMappingId, slotMappingId)
        )
      )
      .orderBy(desc(sceneEvidencePreviews.createdAt))
      .limit(1);
    if (attributed) {
      return toDomain(attributed);
    }
    // Only reached when this slot has no frame of its own: a capture taken
    // before slot attribution existed is unattributed, and that is the only
    // thing it could ever have been. A frame belonging to ANOTHER mapping is
    // excluded from both branches - see findLatestForSlot's own contract in
    // domain/scene-evidence-preview/types.ts.
    const [unattributed] = await this.db
      .select()
      .from(sceneEvidencePreviews)
      .where(
        and(
          eq(sceneEvidencePreviews.projectId, projectId),
          eq(sceneEvidencePreviews.manifestCompositionId, manifestCompositionId),
          isNull(sceneEvidencePreviews.slotMappingId)
        )
      )
      .orderBy(desc(sceneEvidencePreviews.createdAt))
      .limit(1);
    return unattributed ? toDomain(unattributed) : null;
  }

  async findByIdForProject(id: string, projectId: string): Promise<SceneEvidencePreviewRecord | null> {
    const [row] = await this.db
      .select()
      .from(sceneEvidencePreviews)
      .where(and(eq(sceneEvidencePreviews.id, id), eq(sceneEvidencePreviews.projectId, projectId)));
    return row ? toDomain(row) : null;
  }
}
