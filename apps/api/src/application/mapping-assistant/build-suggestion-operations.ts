import type { ExecutionPlanEditOperation } from "@dyo/schemas";
import { placeholderTypeForMediaKind } from "../../domain/asset/placeholder-type-for-media-kind.js";
import type { AssetRecord } from "../../domain/asset/types.js";
import type { MappingSuggestionRecord } from "../../domain/mapping-suggestion/types.js";

/**
 * Builds the exact typed execution-plan edit operations one accepted
 * suggestion turns into - shared by accept-mapping-suggestion.ts and
 * batch-accept-mapping-suggestions.ts so the single/batch accept paths
 * can never silently diverge in behavior. `asset` is only ever passed
 * when `suggestion.suggestedAssetId` has already been independently
 * re-validated as a real, currently-owned asset by the caller - this
 * function performs no validation itself, it only shapes operations.
 */
export function buildSuggestionOperations(suggestion: MappingSuggestionRecord, asset: AssetRecord | null): ExecutionPlanEditOperation[] {
  const operations: ExecutionPlanEditOperation[] = [];

  if (asset !== null && suggestion.mappingId !== null) {
    operations.push({
      type: "MAP_ASSET",
      scenePlanId: suggestion.scenePlanId,
      mappingId: suggestion.mappingId,
      selectedAssetId: asset.id,
      selectedAssetType: placeholderTypeForMediaKind(asset.mediaKind)
    });
  }

  if (suggestion.suggestedText !== null && suggestion.mappingId !== null) {
    operations.push({ type: "SET_TEXT", scenePlanId: suggestion.scenePlanId, mappingId: suggestion.mappingId, text: suggestion.suggestedText });
  }

  if (suggestion.suggestedAssetTimestamp !== null && suggestion.mappingId !== null) {
    operations.push({
      type: "SET_ASSET_TIMESTAMP",
      scenePlanId: suggestion.scenePlanId,
      mappingId: suggestion.mappingId,
      assetTimestamp: suggestion.suggestedAssetTimestamp
    });
  }

  if (suggestion.suggestedFinalDuration !== null) {
    operations.push({ type: "SET_FINAL_DURATION", scenePlanId: suggestion.scenePlanId, finalDuration: suggestion.suggestedFinalDuration });
  }

  return operations;
}
