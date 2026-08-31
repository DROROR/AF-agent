import type { MappingSuggestion } from "@dyo/schemas";

/**
 * Client-handoff phase, section I ("Mapping Assistant — bulk review UX"):
 * "may select/accept only suggestions satisfying a strict safe policy...
 * direct evidence, sufficiently high confidence, non-structural content
 * target, valid asset/text reference, not marked Needs review... Do NOT
 * include low-confidence guesses, masks, phone hardware, cameras,
 * decorative shape layers, uncertain structural elements."
 *
 * This is a UI selection convenience only, never a security boundary -
 * `/mapping-suggestions/accept-batch` (batch-accept-mapping-suggestions.ts)
 * already independently re-validates every referenced suggestion is
 * PENDING and (if it names one) references a real asset before applying
 * anything, and a user could always accept the exact same suggestions one
 * at a time via the individual Accept button regardless of this filter.
 *
 * Deliberately reuses the domain's OWN existing trust signals rather than
 * inventing a new heuristic:
 *   - `requiresHumanReview` is already false ONLY for the deterministic
 *     matcher's highest-trust rules (an explicit Work Map assignment, or a
 *     brand-logo match) and true for anything merely heuristic (e.g. an
 *     exact filename match) - see deterministic-matcher.ts's own doc
 *     comment ("a real fact, but only a heuristic, so it still asks for
 *     extra scrutiny").
 *   - `unresolvedReason` is non-null exactly when generate-mapping-
 *     suggestions.ts's own low-confidence-guess safety gate (or a Work Map
 *     conflict) already downgraded a proposal to "Needs review" - see that
 *     file's own doc comment. A structural/decorative element the model
 *     was never confident about therefore already fails this check before
 *     this predicate ever runs.
 *   - `confidence >= 0.75` matches confidenceLevel()'s own "High" tier in
 *     MappingAssistantPanel.tsx - the same threshold the UI already shows
 *     as the plain-language "High" badge.
 */
const SAFE_CONFIDENCE_THRESHOLD = 0.75;

export function isSafeToBulkAccept(suggestion: MappingSuggestion): boolean {
  return (
    suggestion.status === "PENDING" &&
    suggestion.unresolvedReason === null &&
    !suggestion.requiresHumanReview &&
    !suggestion.conflictsWithWorkMap &&
    suggestion.confidence >= SAFE_CONFIDENCE_THRESHOLD &&
    (suggestion.suggestedAssetId !== null || suggestion.suggestedText !== null)
  );
}
