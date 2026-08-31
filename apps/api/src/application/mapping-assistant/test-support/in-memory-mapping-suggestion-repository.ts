import type { SuggestionStatus } from "@dyo/schemas";
import type { MappingSuggestionRecord, MappingSuggestionRepository, NewMappingSuggestion } from "../../../domain/mapping-suggestion/types.js";

/** In-memory fake used only by unit tests - never imported from production code. Mirrors DrizzleMappingSuggestionRepository's upsertPending semantics (replaces any existing PENDING/RESOLVED row for the same target - see that class's own doc comment). */
export class InMemoryMappingSuggestionRepository implements MappingSuggestionRepository {
  private readonly rows = new Map<string, MappingSuggestionRecord>();

  async upsertPending(row: NewMappingSuggestion, now: Date): Promise<MappingSuggestionRecord> {
    for (const [id, existing] of this.rows) {
      if (
        (existing.status === "PENDING" || existing.status === "RESOLVED") &&
        existing.projectId === row.projectId &&
        existing.scenePlanId === row.scenePlanId &&
        existing.mappingId === row.mappingId
      ) {
        this.rows.delete(id);
      }
    }
    const record: MappingSuggestionRecord = { ...row, status: row.status ?? "PENDING", createdAt: now, updatedAt: now };
    this.rows.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<MappingSuggestionRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async listByProjectId(projectId: string): Promise<MappingSuggestionRecord[]> {
    return [...this.rows.values()].filter((row) => row.projectId === projectId);
  }

  async updateStatus(id: string, status: Exclude<SuggestionStatus, "PENDING">, now: Date): Promise<MappingSuggestionRecord | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const updated: MappingSuggestionRecord = { ...existing, status, updatedAt: now };
    this.rows.set(id, updated);
    return updated;
  }
}
