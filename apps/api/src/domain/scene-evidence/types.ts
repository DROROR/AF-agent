import type { SceneEvidenceResponse } from "@dyo/schemas";

/**
 * A durable, historical fact record of one successful INSPECT_SCENE_EVIDENCE
 * job result (evidence-persistence phase). Immutable once written - a
 * re-inspection creates a new record rather than mutating this one, so an
 * older record's own facts never silently change out from under a consumer
 * that already read them.
 */
export interface SceneEvidenceRecord {
  id: string;
  projectId: string;
  jobId: string;
  manifestCompositionId: string;
  sourceProjectSha256: string;
  response: SceneEvidenceResponse;
  capturedAt: Date;
  createdAt: Date;
}

export interface NewSceneEvidenceRecord {
  id: string;
  projectId: string;
  jobId: string;
  manifestCompositionId: string;
  sourceProjectSha256: string;
  response: SceneEvidenceResponse;
  capturedAt: Date;
}

/**
 * Port the application layer depends on - see docs/engineering/CODE_STANDARDS.md's
 * dependency direction (route -> application -> domain -> repository).
 * Implemented by infrastructure/db/drizzle-scene-evidence-repository.ts in
 * production and an in-memory fake in unit tests.
 */
export interface SceneEvidenceRepository {
  /**
   * Inserts one evidence record. Idempotent by `jobId`: a duplicate call for
   * a jobId that already has a record is a no-op that returns the EXISTING
   * record rather than erroring or inserting a second one - guards against a
   * duplicate/retried callback ever creating more than one row per job (see
   * the jobs table's own job_id unique constraint on scene_evidence).
   */
  record(row: NewSceneEvidenceRecord, now: Date): Promise<SceneEvidenceRecord>;
  /**
   * The newest evidence record per manifestCompositionId in this project,
   * filtered to only those whose sourceProjectSha256 matches the given
   * value - the ONLY read path the Mapping Assistant may ever treat as
   * current FACT. A record that exists but doesn't match is never returned
   * here, no matter how recent it is.
   */
  listCompatibleByProject(projectId: string, sourceProjectSha256: string): Promise<SceneEvidenceRecord[]>;
  /**
   * The newest evidence record per manifestCompositionId in this project,
   * regardless of sourceProjectSha256 - used only to distinguish "never
   * inspected" from "inspected, but stale" for the dashboard's honest
   * status indicator. Never used to select FACT input for suggestions.
   */
  listLatestByProject(projectId: string): Promise<SceneEvidenceRecord[]>;
}
