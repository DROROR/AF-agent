import { and, desc, eq } from "drizzle-orm";
import { sceneEvidence, type Database, type SceneEvidenceRow } from "@dyo/database";
import type { SceneEvidenceResponse } from "@dyo/schemas";
import type { NewSceneEvidenceRecord, SceneEvidenceRecord, SceneEvidenceRepository } from "../../domain/scene-evidence/types.js";

function toDomain(row: SceneEvidenceRow): SceneEvidenceRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    jobId: row.jobId,
    manifestCompositionId: row.manifestCompositionId,
    sourceProjectSha256: row.sourceProjectSha256,
    response: row.response as SceneEvidenceResponse,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt
  };
}

/**
 * Newest row per manifestCompositionId, from a set already ordered
 * newest-first - the first row seen for a given composition id is the one
 * kept. Done in application code rather than SQL `DISTINCT ON` so this
 * repository's queries stay simple `select ... where ... order by` (the
 * same shape every other repository in this codebase uses), at the small
 * cost of returning slightly more rows than strictly needed - a project's
 * scene-evidence history is bounded by its own (small) scene count times a
 * modest number of re-inspections, never a concern at this scale.
 */
function newestPerComposition(rows: SceneEvidenceRow[]): SceneEvidenceRow[] {
  const seen = new Set<string>();
  const result: SceneEvidenceRow[] = [];
  for (const row of rows) {
    if (seen.has(row.manifestCompositionId)) {
      continue;
    }
    seen.add(row.manifestCompositionId);
    result.push(row);
  }
  return result;
}

export class DrizzleSceneEvidenceRepository implements SceneEvidenceRepository {
  constructor(private readonly db: Database) {}

  async record(row: NewSceneEvidenceRecord, now: Date): Promise<SceneEvidenceRecord> {
    const [inserted] = await this.db
      .insert(sceneEvidence)
      .values({
        id: row.id,
        projectId: row.projectId,
        jobId: row.jobId,
        manifestCompositionId: row.manifestCompositionId,
        sourceProjectSha256: row.sourceProjectSha256,
        response: row.response,
        capturedAt: row.capturedAt,
        createdAt: now
      })
      .onConflictDoNothing({ target: sceneEvidence.jobId })
      .returning();

    if (inserted) {
      return toDomain(inserted);
    }

    // A row already exists for this jobId (duplicate/retried callback) -
    // return the existing record rather than erroring, so the write path
    // stays idempotent from its caller's point of view.
    const [existing] = await this.db.select().from(sceneEvidence).where(eq(sceneEvidence.jobId, row.jobId));
    if (!existing) {
      throw new Error(`scene_evidence insert for job ${row.jobId} conflicted, but no existing row was found`);
    }
    return toDomain(existing);
  }

  async listCompatibleByProject(projectId: string, sourceProjectSha256: string): Promise<SceneEvidenceRecord[]> {
    const rows = await this.db
      .select()
      .from(sceneEvidence)
      .where(and(eq(sceneEvidence.projectId, projectId), eq(sceneEvidence.sourceProjectSha256, sourceProjectSha256)))
      .orderBy(desc(sceneEvidence.capturedAt));
    return newestPerComposition(rows).map(toDomain);
  }

  async listLatestByProject(projectId: string): Promise<SceneEvidenceRecord[]> {
    const rows = await this.db
      .select()
      .from(sceneEvidence)
      .where(eq(sceneEvidence.projectId, projectId))
      .orderBy(desc(sceneEvidence.capturedAt));
    return newestPerComposition(rows).map(toDomain);
  }
}
