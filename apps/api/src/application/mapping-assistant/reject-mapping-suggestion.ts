import type { RejectMappingSuggestionResponse } from "@dyo/schemas";
import { SuggestionNotFoundError, SuggestionNotPendingError } from "../../errors/app-error.js";
import type { MappingSuggestionRepository } from "../../domain/mapping-suggestion/types.js";
import { findOwnedSuggestion } from "./find-owned-suggestion.js";
import { toMappingSuggestionDto } from "./mapping-suggestion-dto-mapper.js";

export interface RejectMappingSuggestionDeps {
  mappingSuggestionRepository: MappingSuggestionRepository;
  now: () => Date;
}

/** Leaves the execution plan completely untouched - reject is purely a review decision, never an edit (section 14: "reject leaves plan unchanged"). */
export async function rejectMappingSuggestion(
  deps: RejectMappingSuggestionDeps,
  projectId: string,
  suggestionId: string
): Promise<RejectMappingSuggestionResponse> {
  const suggestion = await findOwnedSuggestion(deps.mappingSuggestionRepository, projectId, suggestionId);
  if (suggestion.status !== "PENDING") {
    throw new SuggestionNotPendingError(suggestionId, suggestion.status);
  }
  const updated = await deps.mappingSuggestionRepository.updateStatus(suggestionId, "REJECTED", deps.now());
  if (!updated) {
    throw new SuggestionNotFoundError(suggestionId);
  }
  return { suggestion: toMappingSuggestionDto(updated) };
}
