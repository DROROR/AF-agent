import { SuggestionCrossProjectAccessError, SuggestionNotFoundError } from "../../errors/app-error.js";
import type { MappingSuggestionRecord, MappingSuggestionRepository } from "../../domain/mapping-suggestion/types.js";

/** Same shared-ownership-check pattern as find-owned-asset.ts - a suggestion that exists but belongs to a different project is refused exactly like one that doesn't exist at all. */
export async function findOwnedSuggestion(
  mappingSuggestionRepository: MappingSuggestionRepository,
  projectId: string,
  suggestionId: string
): Promise<MappingSuggestionRecord> {
  const suggestion = await mappingSuggestionRepository.findById(suggestionId);
  if (!suggestion) {
    throw new SuggestionNotFoundError(suggestionId);
  }
  if (suggestion.projectId !== projectId) {
    throw new SuggestionCrossProjectAccessError(suggestionId, projectId);
  }
  return suggestion;
}
