import type { RenderOutputVariant } from "@dyo/schemas";

/**
 * A durable, historical record of one successful RENDER job result
 * (render-engine phase section 11/12, extended by render-delivery phase
 * section 5) - mirrors apps/api/src/domain/scene-evidence/types.ts's own
 * SceneEvidenceRecord. Immutable once written. Deliberately carries no
 * filesystem path - `storageKey` is an opaque AssetStorage identifier
 * (render_artifacts' own table doc comment, packages/database/src/schema.ts),
 * never a path a browser client ever sees directly.
 */
export interface RenderArtifactRecord {
  id: string;
  projectId: string;
  jobId: string;
  variant: RenderOutputVariant;
  compositionName: string;
  workingProjectSha256: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  sha256: string;
  renderStartedAt: Date;
  renderCompletedAt: Date;
  aerenderExitCode: number;
  logExcerpt: string | null;
  validationStatus: "VALID";
  createdAt: Date;
}

export interface NewRenderArtifactRecord {
  id: string;
  projectId: string;
  jobId: string;
  variant: RenderOutputVariant;
  compositionName: string;
  workingProjectSha256: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  sha256: string;
  renderStartedAt: Date;
  renderCompletedAt: Date;
  aerenderExitCode: number;
  logExcerpt: string | null;
}

/**
 * Port the application layer depends on - implemented by
 * infrastructure/db/drizzle-render-artifact-repository.ts in production
 * and an in-memory fake in unit tests (same pattern as
 * SceneEvidenceRepository).
 */
export interface RenderArtifactRepository {
  /**
   * Inserts one artifact record. Idempotent by `jobId`: a duplicate call
   * for a jobId that already has a record is a no-op that returns the
   * EXISTING record rather than erroring or inserting a second one - see
   * the render_artifacts table's own job_id unique constraint.
   */
  record(row: NewRenderArtifactRecord, now: Date): Promise<RenderArtifactRecord>;
  /** Every artifact recorded for a project, newest first - the dashboard's own render-results list (section 12). */
  listByProject(projectId: string): Promise<RenderArtifactRecord[]>;
  /** One artifact by id, scoped to the given projectId - null if it doesn't exist OR belongs to a different project (never distinguishable from the outside, matching this project's "same shape whether not found or not yours" convention). */
  findByIdForProject(id: string, projectId: string): Promise<RenderArtifactRecord | null>;
}
