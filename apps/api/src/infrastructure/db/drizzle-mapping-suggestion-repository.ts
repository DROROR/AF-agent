import { and, eq, inArray, isNull } from "drizzle-orm";
import { mappingSuggestions, type Database, type MappingSuggestionRow } from "@dyo/database";
import type { SuggestionStatus } from "@dyo/schemas";
import type { MappingSuggestionRecord, MappingSuggestionRepository, NewMappingSuggestion } from "../../domain/mapping-suggestion/types.js";

function toDomain(row: MappingSuggestionRow): MappingSuggestionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    scenePlanId: row.scenePlanId,
    mappingId: row.mappingId,
    source: row.source,
    status: row.status,
    suggestedClassification: row.suggestedClassification,
    suggestedAssetId: row.suggestedAssetId,
    suggestedText: row.suggestedText,
    suggestedAssetTimestamp: row.suggestedAssetTimestamp,
    suggestedFinalDuration: row.suggestedFinalDuration,
    confidence: row.confidence,
    reasoning: row.reasoning,
    evidenceRefs: row.evidenceRefs,
    unresolvedReason: row.unresolvedReason,
    requiresHumanReview: row.requiresHumanReview,
    conflictsWithWorkMap: row.conflictsWithWorkMap,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class DrizzleMappingSuggestionRepository implements MappingSuggestionRepository {
  constructor(private readonly db: Database) {}

  /**
   * Replaces any existing PENDING or RESOLVED row for the exact same
   * (projectId, scenePlanId, mappingId) target in one transaction - never
   * lets duplicate open suggestions accumulate for one target (see
   * domain/mapping-suggestion/types.ts's own doc comment on why this is
   * an application-level rule, not a DB constraint). RESOLVED is included
   * alongside PENDING (mapping-review deadlock fix, section G): it is
   * still a system-generated, not-yet-human-decided outcome, so a
   * regeneration that finds the same target no longer resolves the same
   * way (e.g. the Work Map or manifest changed) must replace it exactly
   * like a PENDING row - never leaves a stale RESOLVED row sitting
   * alongside a fresh PENDING/RESOLVED one for the same target.
   * ACCEPTED/REJECTED are real human decisions and are never touched
   * here.
   */
  async upsertPending(row: NewMappingSuggestion, now: Date): Promise<MappingSuggestionRecord> {
    return this.db.transaction(async (tx) => {
      const mappingIdCondition = row.mappingId === null ? isNull(mappingSuggestions.mappingId) : eq(mappingSuggestions.mappingId, row.mappingId);
      await tx
        .delete(mappingSuggestions)
        .where(
          and(
            eq(mappingSuggestions.projectId, row.projectId),
            eq(mappingSuggestions.scenePlanId, row.scenePlanId),
            mappingIdCondition,
            inArray(mappingSuggestions.status, ["PENDING", "RESOLVED"])
          )
        );

      const [inserted] = await tx
        .insert(mappingSuggestions)
        .values({
          id: row.id,
          projectId: row.projectId,
          scenePlanId: row.scenePlanId,
          mappingId: row.mappingId,
          source: row.source,
          status: row.status ?? "PENDING",
          suggestedClassification: row.suggestedClassification,
          suggestedAssetId: row.suggestedAssetId,
          suggestedText: row.suggestedText,
          suggestedAssetTimestamp: row.suggestedAssetTimestamp,
          suggestedFinalDuration: row.suggestedFinalDuration,
          confidence: row.confidence,
          reasoning: row.reasoning,
          evidenceRefs: row.evidenceRefs,
          unresolvedReason: row.unresolvedReason,
          requiresHumanReview: row.requiresHumanReview,
          conflictsWithWorkMap: row.conflictsWithWorkMap,
          createdAt: now,
          updatedAt: now
        })
        .returning();
      if (!inserted) {
        throw new Error("insert into mapping_suggestions returned no row");
      }
      return toDomain(inserted);
    });
  }

  async findById(id: string): Promise<MappingSuggestionRecord | null> {
    const [row] = await this.db.select().from(mappingSuggestions).where(eq(mappingSuggestions.id, id));
    return row ? toDomain(row) : null;
  }

  async listByProjectId(projectId: string): Promise<MappingSuggestionRecord[]> {
    const rows = await this.db.select().from(mappingSuggestions).where(eq(mappingSuggestions.projectId, projectId));
    return rows.map(toDomain);
  }

  async updateStatus(id: string, status: Exclude<SuggestionStatus, "PENDING">, now: Date): Promise<MappingSuggestionRecord | null> {
    const [row] = await this.db
      .update(mappingSuggestions)
      .set({ status, updatedAt: now })
      .where(eq(mappingSuggestions.id, id))
      .returning();
    return row ? toDomain(row) : null;
  }
}
