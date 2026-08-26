import type { AiSuggestion, SceneEvidenceResponse } from "@dyo/schemas";

/**
 * Converts a real, AE-confirmed SceneEvidence result into a mapping
 * suggestion - reusing AiSuggestion's own strict contract (ai-suggestion.ts)
 * rather than inventing a parallel type. Like every AiSuggestion, this is
 * never itself a PlaceholderMapping and is never auto-approved: a human
 * (or a separate, explicit edit operation) must still apply it via the
 * same typed MAP_ASSET/SET_TEXT/... edit operations a human uses.
 *
 * Because no currently-allowlisted read-only AE tool exposes layer type,
 * source item identity, or a text layer's value (see scene-evidence.ts's
 * module doc comment), `suggestedClassification`/`suggestedText`/
 * `suggestedAssetId`/`suggestedAssetType`/`suggestedAssetTimestamp` are
 * always null here today, and `confidence` is always 0 - this function
 * records what was actually observed as evidence, it never fabricates a
 * semantic role to fill those fields in. Returns null only when the
 * requested layerIndex was not present in the evidence at all (e.g. the
 * worker could not reach that layer) - there is nothing to suggest.
 */
export function sceneEvidenceToMappingSuggestion(
  evidence: SceneEvidenceResponse,
  manifestPlaceholderId: string,
  layerIndex: number
): AiSuggestion | null {
  const layer = evidence.layers.find((candidate) => candidate.layerIndex === layerIndex);
  if (!layer) {
    return null;
  }

  const observedFacts = [
    `layer "${layer.name}" (index ${layer.layerIndex}) in composition "${evidence.compositionName}" (manifestCompositionId ${evidence.manifestCompositionId})`,
    `enabled=${layer.enabled}, nullLayer=${layer.nullLayer}, threeDLayer=${layer.threeDLayer}, parentLayerName=${layer.parentLayerName ?? "none"}`,
    `timing: inPoint=${layer.inPointSeconds}s outPoint=${layer.outPointSeconds}s startTime=${layer.startTimeSeconds}s`,
    "layer type, source item identity, and text value are not exposed by any currently-allowlisted read-only AE tool - not inferred from the layer or composition name"
  ];

  return {
    manifestCompositionId: evidence.manifestCompositionId,
    manifestPlaceholderId,
    suggestedClassification: null,
    suggestedText: null,
    suggestedAssetId: null,
    suggestedAssetType: null,
    suggestedAssetTimestamp: null,
    confidence: 0,
    evidence: observedFacts
  };
}
