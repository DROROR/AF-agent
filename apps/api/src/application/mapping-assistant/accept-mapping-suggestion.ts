import type { AcceptMappingSuggestionResponse } from "@dyo/schemas";
import {
  ExecutionPlanNotFoundError,
  SuggestedAssetInvalidError,
  SuggestionNotFoundError,
  SuggestionNotPendingError
} from "../../errors/app-error.js";
import type { MappingSuggestionRepository } from "../../domain/mapping-suggestion/types.js";
import { updateExecutionPlan, type UpdateExecutionPlanDeps } from "../execution-plan/update-execution-plan.js";
import { toExecutionPlanResponse } from "../execution-plan/execution-plan-dto-mapper.js";
import { buildSuggestionOperations } from "./build-suggestion-operations.js";
import { findOwnedSuggestion } from "./find-owned-suggestion.js";
import { toMappingSuggestionDto } from "./mapping-suggestion-dto-mapper.js";

export interface AcceptMappingSuggestionDeps extends UpdateExecutionPlanDeps {
  mappingSuggestionRepository: MappingSuggestionRepository;
}

/**
 * Turns one PENDING suggestion into a real execution-plan edit ONLY via
 * the exact same typed MAP_ASSET/SET_TEXT/SET_ASSET_TIMESTAMP/
 * SET_FINAL_DURATION operations a human uses manually - never a second,
 * less-validated write path (section 7). `suggestedAssetId` is
 * re-validated against this exact project's real, currently-existing
 * Asset Catalog right now, not trusted from whenever the suggestion was
 * generated - an asset deleted since then fails loudly here rather than
 * silently mapping a dangling id. If the suggestion carries no
 * actionable field at all (e.g. only an advisory suggestedClassification,
 * which has no corresponding edit operation), the suggestion is still
 * marked ACCEPTED but the plan is left untouched - no revision bump for
 * a no-op edit.
 */
export async function acceptMappingSuggestion(
  deps: AcceptMappingSuggestionDeps,
  projectId: string,
  suggestionId: string,
  baseRevision: number
): Promise<AcceptMappingSuggestionResponse> {
  const suggestion = await findOwnedSuggestion(deps.mappingSuggestionRepository, projectId, suggestionId);
  if (suggestion.status !== "PENDING") {
    throw new SuggestionNotPendingError(suggestionId, suggestion.status);
  }

  let asset = null;
  if (suggestion.suggestedAssetId !== null) {
    asset = await deps.assetRepository.findById(suggestion.suggestedAssetId);
    if (!asset || asset.projectId !== projectId) {
      throw new SuggestedAssetInvalidError(suggestion.suggestedAssetId);
    }
  }

  const operations = buildSuggestionOperations(suggestion, asset);

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

  const updated = await deps.mappingSuggestionRepository.updateStatus(suggestionId, "ACCEPTED", deps.now());
  if (!updated) {
    throw new SuggestionNotFoundError(suggestionId);
  }

  return { suggestion: toMappingSuggestionDto(updated), executionPlan };
}
