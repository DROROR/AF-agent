import type { MappingSuggestion } from "@dyo/schemas";
import type { MappingSuggestionRecord } from "../../domain/mapping-suggestion/types.js";

export function toMappingSuggestionDto(record: MappingSuggestionRecord): MappingSuggestion {
  return {
    id: record.id,
    projectId: record.projectId,
    scenePlanId: record.scenePlanId,
    mappingId: record.mappingId,
    source: record.source,
    status: record.status,
    suggestedClassification: record.suggestedClassification,
    suggestedAssetId: record.suggestedAssetId,
    suggestedText: record.suggestedText,
    suggestedAssetTimestamp: record.suggestedAssetTimestamp,
    suggestedFinalDuration: record.suggestedFinalDuration,
    confidence: record.confidence,
    reasoning: record.reasoning,
    evidenceRefs: record.evidenceRefs,
    unresolvedReason: record.unresolvedReason,
    requiresHumanReview: record.requiresHumanReview,
    conflictsWithWorkMap: record.conflictsWithWorkMap,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}
