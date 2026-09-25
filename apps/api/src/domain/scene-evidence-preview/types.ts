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
  /** The moment in the composition's own timeline this frame shows, or null when the capture predates this being recorded. */
  capturedAtSeconds: number | null;
  /** The execution-plan mapping this frame was captured as evidence FOR, or null when it is not attributed to one slot (a plain representative scene frame, or a capture taken before slot attribution existed). */
  slotMappingId: string | null;
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
  capturedAtSeconds: number | null;
  slotMappingId: string | null;
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
  /**
   * The newest frame that is evidence FOR ONE SLOT, rather than for the whole
   * composition (real 2026-09-24 defect - see docs/ACCEPTANCE.md and
   * slotMappingId's own column comment in packages/database/src/schema.ts).
   *
   * Two sets, never mixed, in this order:
   *  1. the frames captured FOR THIS MAPPING (`slot_mapping_id` = mappingId),
   *     newest first - so capturing another slot's frame can never supersede
   *     this slot's own, and re-capturing THIS slot's frame always does;
   *  2. only when this slot has no attributed frame at all, the newest
   *     UNATTRIBUTED frame (`slot_mapping_id IS NULL`) - which is everything a
   *     capture taken before slot attribution existed could ever have been,
   *     so an older project keeps behaving exactly as it did.
   *
   * A frame attributed to a DIFFERENT mapping is never returned by either
   * step: it proves something about another slot, not this one.
   *
   * Staleness is still the caller's to judge on sha256, exactly as with
   * findLatestForComposition above.
   */
  findLatestForSlot(projectId: string, manifestCompositionId: string, slotMappingId: string): Promise<SceneEvidencePreviewRecord | null>;
  /** One preview by id, scoped to the given projectId - null if it doesn't exist OR belongs to a different project. */
  findByIdForProject(id: string, projectId: string): Promise<SceneEvidencePreviewRecord | null>;
}
