import { describe, expect, it } from "vitest";
import { matchDeterministic } from "../deterministic-matcher.js";
import type { MappingEvidenceBundle } from "../../mapping-evidence/types.js";
import type { AssetRecord } from "../../asset/types.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");

function asset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: "asset-1",
    projectId: "proj-1",
    originalFilename: "hero.png",
    storageKey: "proj-1/hero.png",
    mediaKind: "IMAGE",
    mimeType: "image/png",
    byteSize: 100,
    sha256: "a".repeat(64),
    width: null,
    height: null,
    durationSeconds: null,
    label: null,
    notes: null,
    uploadedAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function bundle(overrides: Partial<MappingEvidenceBundle> = {}): MappingEvidenceBundle {
  return {
    scenePlanId: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene 01",
    sourcePosition: 0,
    mappingId: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "Hero Image",
    currentClassification: null,
    sceneEvidence: null,
    workMapEntry: null,
    candidateAssets: [],
    userInstructions: null,
    brandInputs: null,
    ...overrides
  };
}

describe("matchDeterministic", () => {
  it("returns null when there is no evidence to match on", () => {
    expect(matchDeterministic(bundle({ placeholderName: null }))).toBeNull();
  });

  it("matches a Work Map's explicit desiredAssetId - confidence 1, never requires extra review", () => {
    const heroAsset = asset({ id: "asset-42", label: "Client hero" });
    const result = matchDeterministic(
      bundle({
        candidateAssets: [heroAsset],
        workMapEntry: {
          id: "wm-1",
          sourceCompositionId: "comp-1",
          sourceReference: null,
          desiredAssetId: "asset-42",
          desiredText: null,
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      })
    );
    expect(result).toMatchObject({ suggestedAssetId: "asset-42", confidence: 1, requiresHumanReview: false, conflictsWithWorkMap: false });
    expect(result?.evidenceRefs[0]?.kind).toBe("USER_INTENT");
  });

  it("surfaces a conflict (never silently drops or substitutes) when the Work Map names an asset that does not exist", () => {
    const result = matchDeterministic(
      bundle({
        candidateAssets: [asset({ id: "asset-1" })],
        workMapEntry: {
          id: "wm-1",
          sourceCompositionId: "comp-1",
          sourceReference: null,
          desiredAssetId: "asset-does-not-exist",
          desiredText: null,
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      })
    );
    expect(result?.suggestedAssetId).toBeNull();
    expect(result?.conflictsWithWorkMap).toBe(true);
    expect(result?.requiresHumanReview).toBe(true);
    expect(result?.unresolvedReason).not.toBeNull();
  });

  it("matches a Work Map's explicit desiredText when no asset is named", () => {
    const result = matchDeterministic(
      bundle({
        workMapEntry: {
          id: "wm-1",
          sourceCompositionId: "comp-1",
          sourceReference: null,
          desiredAssetId: null,
          desiredText: "Hello world",
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      })
    );
    expect(result).toMatchObject({ suggestedText: "Hello world", confidence: 1, requiresHumanReview: false });
  });

  it("matches the project's brand logo asset only when the placeholder is a real, manifest-classified logo slot", () => {
    const logoAsset = asset({ id: "logo-1", mediaKind: "LOGO" });
    const result = matchDeterministic(
      bundle({
        currentClassification: "logo",
        candidateAssets: [logoAsset],
        brandInputs: { logoAssetId: "logo-1", brandColors: [], textInstructions: null }
      })
    );
    expect(result).toMatchObject({ suggestedAssetId: "logo-1", suggestedClassification: "logo", confidence: 1, requiresHumanReview: false });
  });

  it("never guesses a logo assignment when the placeholder itself is not classified as logo - no semantic role invented without evidence", () => {
    const result = matchDeterministic(
      bundle({
        currentClassification: null,
        placeholderName: null,
        candidateAssets: [asset({ id: "logo-1", mediaKind: "LOGO" })],
        brandInputs: { logoAssetId: "logo-1", brandColors: [], textInstructions: null }
      })
    );
    expect(result).toBeNull();
  });

  it("matches an asset whose label exactly equals the placeholder's layer name, but flags it for extra review (a heuristic, not explicit intent)", () => {
    const result = matchDeterministic(
      bundle({
        placeholderName: "Hero Image",
        candidateAssets: [asset({ id: "asset-9", label: "Hero Image" })]
      })
    );
    expect(result).toMatchObject({ suggestedAssetId: "asset-9", confidence: 0.75, requiresHumanReview: true });
  });

  it("matches an asset whose real filename exactly equals the placeholder's layer name when no label is set", () => {
    const result = matchDeterministic(
      bundle({
        placeholderName: "hero.png",
        candidateAssets: [asset({ id: "asset-9", label: null, originalFilename: "hero.png" })]
      })
    );
    expect(result?.suggestedAssetId).toBe("asset-9");
  });

  it("never invents a match from scene evidence alone - a populated sceneEvidence with no Work Map/brand/label signal still resolves to nothing", () => {
    const result = matchDeterministic(
      bundle({
        placeholderName: null,
        sceneEvidence: {
          verifiedSourceProjectSha256: "a".repeat(64),
          manifestCompositionId: "comp-1",
          aeProjectItemIndex: 1,
          compositionName: "Scene 01",
          layers: [
            {
              layerIndex: 1,
              name: "Hero Image",
              enabled: true,
              nullLayer: false,
              threeDLayer: false,
              inPointSeconds: 0,
              outPointSeconds: 5,
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
          capturedAt: NOW.toISOString()
        }
      })
    );
    expect(result).toBeNull();
  });

  describe("mapping-review deadlock fix (section A/B/E): structural/template-helper elements resolve with no replacement and no review required", () => {
    it.each(["Camera 1", "Phone_mask.png", "Phone.png", "Shape Layer 1", "CONTROL", "Scene Wrapper"])(
      "resolves %s with no replacement, no human review, no conflict",
      (name) => {
        const result = matchDeterministic(bundle({ placeholderName: name }));
        expect(result).toMatchObject({
          suggestedAssetId: null,
          suggestedText: null,
          requiresHumanReview: false,
          conflictsWithWorkMap: false,
          unresolvedReason: null
        });
      }
    );

    it("never assigns a random uploaded asset to a structural layer, even when an asset happens to share its exact filename (section E)", () => {
      const result = matchDeterministic(
        bundle({
          placeholderName: "Phone_mask.png",
          candidateAssets: [asset({ id: "coincidental-match", label: null, originalFilename: "Phone_mask.png" })]
        })
      );
      expect(result?.suggestedAssetId).toBeNull();
    });

    it("an explicit Work Map asset assignment for a structural-named layer still wins (a human deliberately overriding it is never silently discarded)", () => {
      const result = matchDeterministic(
        bundle({
          placeholderName: "CONTROL",
          candidateAssets: [asset({ id: "override-asset" })],
          workMapEntry: {
            id: "wm-1",
            sourceCompositionId: "comp-1",
            sourceReference: null,
            desiredAssetId: "override-asset",
            desiredText: null,
            assetTimestampSeconds: null,
            desiredDurationSeconds: null,
            instructions: null
          }
        })
      );
      expect(result?.suggestedAssetId).toBe("override-asset");
      expect(result?.requiresHumanReview).toBe(false);
    });

    it("never resolves a real content target (Phone_screen) just because the scene's own instructions say to keep the wrapper unchanged (section D)", () => {
      const result = matchDeterministic(bundle({ placeholderName: "Phone_screen", userInstructions: "Keep scene wrapper animation unchanged." }));
      expect(result).toBeNull();
    });

    it("never resolves nested text just because a sibling structural layer exists in the same scene", () => {
      const result = matchDeterministic(bundle({ placeholderName: "Body Text", userInstructions: "Keep scene wrapper animation unchanged." }));
      expect(result).toBeNull();
    });

    it("real production bug on test22 (false Needs Review): a composition-level target (no placeholder detected at all - mappingId/placeholderName both null) whose Work Map entry explicitly marks the whole scene a structural wrapper resolves with no replacement and no review, never reaching the AI provider at all", () => {
      const result = matchDeterministic(
        bundle({
          placeholderName: null,
          mappingId: null,
          manifestPlaceholderId: null,
          currentClassification: null,
          workMapEntry: {
            id: "wm-1",
            sourceCompositionId: "comp-1",
            sourceReference: null,
            desiredAssetId: null,
            desiredText: null,
            assetTimestampSeconds: null,
            desiredDurationSeconds: null,
            instructions: "Work Map explicitly states this is a structural scene wrapper to keep unchanged. No evidence supports content assignment."
          }
        })
      );
      expect(result).toMatchObject({
        suggestedAssetId: null,
        suggestedText: null,
        requiresHumanReview: false,
        conflictsWithWorkMap: false,
        unresolvedReason: null
      });
    });

    it("a Phone_Comp-named placeholder resolves as structural, same as Phone.png/Phone_mask.png", () => {
      const result = matchDeterministic(bundle({ placeholderName: "Phone_Comp 01" }));
      expect(result).toMatchObject({ requiresHumanReview: false, suggestedAssetId: null });
    });
  });

  it("Work Map priority: never falls through to the filename-match heuristic when Work Map already has an opinion", () => {
    const result = matchDeterministic(
      bundle({
        placeholderName: "hero.png",
        candidateAssets: [asset({ id: "filename-match", originalFilename: "hero.png" }), asset({ id: "work-map-asset" })],
        workMapEntry: {
          id: "wm-1",
          sourceCompositionId: "comp-1",
          sourceReference: null,
          desiredAssetId: "work-map-asset",
          desiredText: null,
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      })
    );
    expect(result?.suggestedAssetId).toBe("work-map-asset");
  });
});
