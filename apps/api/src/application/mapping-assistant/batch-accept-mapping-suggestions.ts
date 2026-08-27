import type { BatchAcceptMappingSuggestionsResponse, ExecutionPlanEditOperation } from "@dyo/schemas";
import { ExecutionPlanNotFoundError, SuggestedAssetInvalidError, SuggestionNotPendingError } from "../../errors/app-error.js";
import type { MappingSuggestionRecord, MappingSuggestionRepository } from "../../domain/mapping-suggestion/types.js";
import { updateExecutionPlan, type UpdateExecutionPlanDeps } from "../execution-plan/update-execution-plan.js";
import { toExecutionPlanResponse } from "../execution-plan/execution-plan-dto-mapper.js";
import { buildSuggestionOperations } from "./build-suggestion-operations.js";
import { findOwnedSuggestion } from "./find-owned-suggestion.js";
import { toMappingSuggestionDto } from "./mapping-suggestion-dto-mapper.js";

export interface BatchAcceptMappingSuggestionsDeps extends UpdateExecutionPlanDeps {
  mappingSuggestionRepository: MappingSuggestionRepository;
}

/**
 * Accepts several PENDING suggestions as one batched execution-plan
 * edit/revision bump - never partial: every referenced suggestion is
 * first verified to exist, belong to this project, be PENDING, and (if
 * it names one) reference a real asset BEFORE a single edit operation is
 * built or applied. If any one of them fails that check, the whole batch
 * is refused and NOTHING is accepted or changed - the caller must not be
 * left wondering which of several selected rows silently went through.
 */
export async function batchAcceptMappingSuggestions(
  deps: BatchAcceptMappingSuggestionsDeps,
  projectId: string,
  suggestionIds: string[],
  baseRevision: number
): Promise<BatchAcceptMappingSuggestionsResponse> {
  const suggestions: MappingSuggestionRecord[] = [];
  for (const suggestionId of suggestionIds) {
    const suggestion = await findOwnedSuggestion(deps.mappingSuggestionRepository, projectId, suggestionId);
    if (suggestion.status !== "PENDING") {
      throw new SuggestionNotPendingError(suggestionId, suggestion.status);
    }
    suggestions.push(suggestion);
  }

  const operations: ExecutionPlanEditOperation[] = [];
  for (const suggestion of suggestions) {
    let asset = null;
    if (suggestion.suggestedAssetId !== null) {
      asset = await deps.assetRepository.findById(suggestion.suggestedAssetId);
      if (!asset || asset.projectId !== projectId) {
        throw new SuggestedAssetInvalidError(suggestion.suggestedAssetId);
      }
    }
    operations.push(...buildSuggestionOperations(suggestion, asset));
  }

  let executionPlan;
  if (operations.length > 0) {
    executionPlan = await updateExecutionPlan(deps, projectId, { baseRevision, operations });
  } else {
    const currentPlan = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
    if (!currentPlan) {
      throw new ExecutionPlanNotFoundError(projectId);
    }
    executionPlan = toExecutionPlanResponse(currentPlan);
  }

  const now = deps.now();
  const updated = await Promise.all(
    suggestions.map((suggestion) => deps.mappingSuggestionRepository.updateStatus(suggestion.id, "ACCEPTED", now))
  );

  return {
    suggestions: updated.filter((row): row is NonNullable<typeof row> => row !== null).map(toMappingSuggestionDto),
    executionPlan
  };
}
