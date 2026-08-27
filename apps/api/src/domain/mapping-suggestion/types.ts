import type { EvidenceRef, PlaceholderType, SuggestionSource, SuggestionStatus } from "@dyo/schemas";

export interface MappingSuggestionRecord {
  id: string;
  projectId: string;
  scenePlanId: string;
  mappingId: string | null;
  source: SuggestionSource;
  status: SuggestionStatus;
  suggestedClassification: PlaceholderType | null;
  suggestedAssetId: string | null;
  suggestedText: string | null;
  suggestedAssetTimestamp: number | null;
  suggestedFinalDuration: number | null;
  confidence: number;
  reasoning: string | null;
  evidenceRefs: EvidenceRef[];
  unresolvedReason: string | null;
  requiresHumanReview: boolean;
  conflictsWithWorkMap: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NewMappingSuggestion = Omit<MappingSuggestionRecord, "createdAt" | "updatedAt" | "status"> & {
  status?: SuggestionStatus;
};

/**
 * Port the application layer depends on. Unlike execution_plans/
 * project_work_maps, this is NOT append-only: `upsertPending` replaces
 * any existing PENDING row for the exact same (projectId, scenePlanId,
 * mappingId) target in place (never accumulates duplicate open
 * suggestions for one target - see schema.ts's own doc comment on why
 * this is an application-level rule rather than a DB partial-unique
 * index). `updateStatus` is the one other mutation - ACCEPTED/REJECTED
 * rows are kept permanently as an audit trail, never deleted.
 */
export interface MappingSuggestionRepository {
  upsertPending(row: NewMappingSuggestion, now: Date): Promise<MappingSuggestionRecord>;
  findById(id: string): Promise<MappingSuggestionRecord | null>;
  listByProjectId(projectId: string): Promise<MappingSuggestionRecord[]>;
  updateStatus(id: string, status: Exclude<SuggestionStatus, "PENDING">, now: Date): Promise<MappingSuggestionRecord | null>;
}
