import type { RenderOutputVariant } from "@dyo/schemas";

/**
 * Real, server-verified uploaded bytes for one render job (render-delivery
 * phase section 4) - see render_artifact_uploads' own table doc comment
 * (packages/database/src/schema.ts) for why this is kept separate from
 * RenderArtifactRecord.
 */
export interface RenderArtifactUploadRecord {
  id: string;
  projectId: string;
  jobId: string;
  variant: RenderOutputVariant;
  storageKey: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
  createdAt: Date;
}

export interface NewRenderArtifactUploadRecord {
  id: string;
  projectId: string;
  jobId: string;
  variant: RenderOutputVariant;
  storageKey: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
}

export interface RenderArtifactUploadRepository {
  findByJobId(jobId: string): Promise<RenderArtifactUploadRecord | null>;
  /** Inserts a brand-new row - callers must check findByJobId first and use replace() instead if one already exists (see upload-render-artifact.ts's own idempotent/replace-on-differing-content logic). */
  insert(row: NewRenderArtifactUploadRecord, now: Date): Promise<RenderArtifactUploadRecord>;
  /** Replaces an existing row's content in place (a genuine re-render produced different bytes) - never creates a second row for the same jobId (job_id is unique). */
  replace(id: string, row: NewRenderArtifactUploadRecord, now: Date): Promise<RenderArtifactUploadRecord>;
}
