/**
 * Client-handoff phase, "real final preview approval gate" - mirrors
 * apps/api/src/domain/render-artifact/types.ts's own shape exactly, for
 * the genuinely separate full-preview artifact type (see
 * full_preview_artifacts' own table doc comment, packages/database/src/schema.ts).
 */
export interface FullPreviewArtifactRecord {
  id: string;
  projectId: string;
  executionSessionId: string;
  jobId: string;
  workingProjectSha256: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  sha256: string;
  capturedAt: Date;
  createdAt: Date;
}

export interface NewFullPreviewArtifactRecord {
  id: string;
  projectId: string;
  executionSessionId: string;
  jobId: string;
  workingProjectSha256: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  sha256: string;
  capturedAt: Date;
}

/**
 * Port the application layer depends on - implemented by
 * infrastructure/db/drizzle-full-preview-artifact-repository.ts in
 * production and an in-memory fake in unit tests (same pattern as
 * RenderArtifactRepository).
 */
export interface FullPreviewArtifactRepository {
  /** Inserts one artifact record directly (no separate upload-staging table - see upload-full-preview.ts's own doc comment for why this differs from render_artifacts' two-phase pattern). */
  record(row: NewFullPreviewArtifactRecord, now: Date): Promise<FullPreviewArtifactRecord>;
  /** The newest full-preview artifact for this session, or null if none has ever been captured. Never filtered by sha256 here - the caller (resolve-render-dispatch.ts) decides what "fresh enough" means by comparing this record's own workingProjectSha256 against the session's current one. */
  findLatestForSession(executionSessionId: string): Promise<FullPreviewArtifactRecord | null>;
  /** One artifact by id, scoped to the given projectId - null if it doesn't exist OR belongs to a different project (never distinguishable from the outside, same "same shape whether not found or not yours" convention as render_artifacts). */
  findByIdForProject(id: string, projectId: string): Promise<FullPreviewArtifactRecord | null>;
}
