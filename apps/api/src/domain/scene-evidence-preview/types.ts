/**
 * Client-facing UX redesign, "M. VISUAL PREVIEWS ARE MANDATORY" - mirrors
 * apps/api/src/domain/full-preview-artifact/types.ts's own shape exactly,
 * for the genuinely separate per-scene evidence preview frame (see
 * scene_evidence_previews' own table doc comment, packages/database/src/schema.ts).
 */
export interface SceneEvidencePreviewRecord {
  id: string;
  projectId: string;
  jobId: string;
  manifestCompositionId: string;
  sourceProjectSha256: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  sha256: string;
  capturedAt: Date;
  createdAt: Date;
}

export interface NewSceneEvidencePreviewRecord {
  id: string;
  projectId: string;
  jobId: string;
  manifestCompositionId: string;
  sourceProjectSha256: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  sha256: string;
  capturedAt: Date;
}

/**
 * Port the application layer depends on - implemented by
 * infrastructure/db/drizzle-scene-evidence-preview-repository.ts in
 * production and an in-memory fake in unit tests.
 */
export interface SceneEvidencePreviewRepository {
  /** Inserts one preview record directly, idempotent by jobId (a duplicate/retried callback for the same job returns the existing record rather than inserting a second one). */
  record(row: NewSceneEvidencePreviewRecord, now: Date): Promise<SceneEvidencePreviewRecord>;
  /** The newest preview for this composition in this project, or null if none has ever been captured. Never filtered by sha256 here - the caller decides staleness by comparing this record's own sourceProjectSha256 against the project's current manifest sha256. */
  findLatestForComposition(projectId: string, manifestCompositionId: string): Promise<SceneEvidencePreviewRecord | null>;
  /** One preview by id, scoped to the given projectId - null if it doesn't exist OR belongs to a different project. */
  findByIdForProject(id: string, projectId: string): Promise<SceneEvidencePreviewRecord | null>;
}
