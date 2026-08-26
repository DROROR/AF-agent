import { describe, expect, it } from "vitest";
import type { SceneEvidenceResponse } from "@dyo/schemas";
import { sceneEvidenceToMappingSuggestion } from "../scene-evidence-to-suggestion.js";

function evidence(overrides: Partial<SceneEvidenceResponse> = {}): SceneEvidenceResponse {
  return {
    verifiedSourceProjectSha256: "a".repeat(64),
    manifestCompositionId: "comp-275",
    compositionIndex: 14,
    compositionName: "Text 01",
    layers: [
      {
        layerIndex: 1,
        name: "APP PROMO",
        enabled: true,
        nullLayer: false,
        threeDLayer: false,
        inPointSeconds: 0,
        outPointSeconds: 4,
        startTimeSeconds: 0,
        parentLayerName: null,
        opacityPercent: 100,
        layerType: null,
        sourceItemName: null,
        sourceWidthPx: null,
        sourceHeightPx: null,
        sourceDurationSeconds: null,
        textValue: null,
        nestedCompositionId: null,
        evidenceSource: "AE_GET_LAYER"
      }
    ],
    preview: null,
    previewFailureReason: null,
    capturedAt: "2026-08-26T00:00:00.000Z",
    ...overrides
  };
}

describe("sceneEvidenceToMappingSuggestion", () => {
  it("returns null when the requested layerIndex is not present in the evidence - nothing to suggest", () => {
    expect(sceneEvidenceToMappingSuggestion(evidence(), "ph-1", 99)).toBeNull();
  });

  it("never invents a semantic role - suggestedClassification/suggestedText/suggestedAsset* are always null today", () => {
    const suggestion = sceneEvidenceToMappingSuggestion(evidence(), "ph-1", 1);
    expect(suggestion).not.toBeNull();
    expect(suggestion?.suggestedClassification).toBeNull();
    expect(suggestion?.suggestedText).toBeNull();
    expect(suggestion?.suggestedAssetId).toBeNull();
    expect(suggestion?.suggestedAssetType).toBeNull();
    expect(suggestion?.suggestedAssetTimestamp).toBeNull();
    expect(suggestion?.confidence).toBe(0);
  });

  it("records real observed facts as evidence, never fabricating certainty", () => {
    const suggestion = sceneEvidenceToMappingSuggestion(evidence(), "ph-1", 1);
    expect(suggestion?.evidence.length).toBeGreaterThan(0);
    expect(suggestion?.evidence.some((line) => line.includes("APP PROMO"))).toBe(true);
    expect(suggestion?.manifestCompositionId).toBe("comp-275");
    expect(suggestion?.manifestPlaceholderId).toBe("ph-1");
  });
});
