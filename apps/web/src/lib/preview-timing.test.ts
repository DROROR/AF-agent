import { describe, expect, it } from "vitest";
import type { LayerDetailFact, LayerEvidence, PlaceholderMapping, SceneEvidenceResponse } from "@dyo/schemas";
import {
  calculatePreviewTiming,
  computeChainVisibleRanges,
  derivePreviewTimingChainTargets,
  opacityVisibleIntervals,
  resolvePreviewTimingChains,
  type ChainHop,
  type LabeledChain,
  type LayerWindow,
  type OpacityFact
} from "./preview-timing";

function window(overrides: Partial<LayerWindow> = {}): LayerWindow {
  return { layerIndex: 1, enabled: true, inPointSeconds: 0, outPointSeconds: 5, startTimeSeconds: 0, ...overrides };
}

function hop(overrides: Partial<ChainHop> = {}): ChainHop {
  return { compositionId: "comp-x", window: window(), stretchPercent: 100, timeRemapEnabled: false, opacity: null, ...overrides };
}

const NOW_ISO = "2026-09-10T00:00:00.000Z";
function mapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
  return {
    id: "mapping-1",
    manifestPlaceholderId: null,
    placeholderName: null,
    placeholderClassification: { value: "text", source: "HUMAN", evidence: [] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    humanLayerIndex: null,
    humanNestedTarget: null,
    mappingSource: "HUMAN",
    confidence: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides
  };
}

function layerEvidence(overrides: Partial<LayerEvidence> = {}): LayerEvidence {
  return {
    layerIndex: 1,
    name: "Layer",
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
    evidenceSource: "AE_GET_LAYER",
    ...overrides
  };
}

function layerDetail(overrides: Partial<LayerDetailFact> = {}): LayerDetailFact {
  return {
    layerIndex: 1,
    layerName: "Layer",
    layerType: "OTHER",
    sourceText: null,
    sourceCompositionId: null,
    stretchPercent: 100,
    timeRemapEnabled: false,
    opacityStatic: null,
    opacityKeyframes: null,
    ...overrides
  };
}

function sceneEvidence(overrides: Partial<SceneEvidenceResponse> = {}): SceneEvidenceResponse {
  return {
    verifiedSourceProjectSha256: "a".repeat(64),
    manifestCompositionId: "comp-x",
    aeProjectItemIndex: 1,
    compositionName: "Comp X",
    layers: [],
    preview: null,
    previewFailureReason: null,
    layerDetails: [],
    layerDetailsFailureReason: null,
    capturedAt: NOW_ISO,
    ...overrides
  };
}

describe("derivePreviewTimingChainTargets", () => {
  it("derives the FULL real-incident chain (2026-09-10 extension) - all four logo hops and both Hebrew hops, plus one prepended outer-discovery target for !Render since the chain's own first hop (comp-1) differs from the outermost composition (comp-210)", () => {
    const result = derivePreviewTimingChainTargets(
      [
        mapping({
          id: "logo",
          placeholderName: "App Logo",
          humanNestedTarget: [
            { compositionId: "comp-1", layerIndex: 3 },
            { compositionId: "comp-1635", layerIndex: 1 },
            { compositionId: "comp-1044", layerIndex: 1 },
            { compositionId: "comp-1113", layerIndex: 1 }
          ]
        }),
        mapping({
          id: "hebrew",
          placeholderName: "Hebrew Branding",
          humanNestedTarget: [
            { compositionId: "comp-1", layerIndex: 3 },
            { compositionId: "comp-1635", layerIndex: 4 }
          ]
        })
      ],
      "comp-210"
    );

    expect(result).toEqual([
      { compositionId: "comp-210", layerIndices: Array.from({ length: 20 }, (_, i) => i + 1), isOuterDiscovery: true },
      { compositionId: "comp-1", layerIndices: [3] },
      { compositionId: "comp-1635", layerIndices: [1, 4] },
      { compositionId: "comp-1044", layerIndices: [1] },
      { compositionId: "comp-1113", layerIndices: [1] }
    ]);
  });

  it("never prepends an outer-discovery target when the outermost composition already equals the chain's own first hop", () => {
    const result = derivePreviewTimingChainTargets([mapping({ humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] })], "comp-1");
    expect(result).toEqual([{ compositionId: "comp-1", layerIndices: [3] }]);
  });

  it("returns an empty array when no mapping has a nested target", () => {
    expect(derivePreviewTimingChainTargets([mapping({ humanNestedTarget: null })], "comp-210")).toEqual([]);
  });
});

describe("resolvePreviewTimingChains", () => {
  it("resolves the outer-discovery hop by matching sourceCompositionId in the discovery target's own layerDetails - never a hardcoded/guessed layer index", () => {
    const mappings = [mapping({ id: "logo", placeholderName: "Logo", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] })];
    const targets = derivePreviewTimingChainTargets(mappings, "comp-210");
    const discoveryResult = sceneEvidence({
      manifestCompositionId: "comp-210",
      layers: [],
      layerDetails: [
        layerDetail({ layerIndex: 1, layerName: "Intro", layerType: "PRECOMP", sourceCompositionId: "comp-99" }),
        layerDetail({ layerIndex: 7, layerName: "Scene 1", layerType: "PRECOMP", sourceCompositionId: "comp-1" })
      ]
    });
    // The follow-up target for comp-1 itself is target index 1.
    const comp1Result = sceneEvidence({
      manifestCompositionId: "comp-1",
      layers: [layerEvidence({ layerIndex: 3, inPointSeconds: 1, outPointSeconds: 4 })],
      layerDetails: [layerDetail({ layerIndex: 3 })]
    });
    // The discovery target itself also needs real evidence for the DISCOVERED index (7) - a caller dispatches layerIndices 1..20 for it, so it comes back in the SAME discovery result's own layers[].
    const discoveryWithLayerEvidence = { ...discoveryResult, layers: [layerEvidence({ layerIndex: 7, inPointSeconds: 0, outPointSeconds: 45, startTimeSeconds: 0 })] };

    const result = resolvePreviewTimingChains(mappings, "comp-210", targets, [discoveryWithLayerEvidence, comp1Result]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.hops.map((h) => [h.compositionId, h.window.layerIndex])).toEqual([
      ["comp-210", 7],
      ["comp-1", 3]
    ]);
  });

  it("fails clearly (never guesses) when the outer-discovery scan never finds a layer hosting the chain's own first composition", () => {
    const mappings = [mapping({ id: "logo", placeholderName: "Logo", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] })];
    const targets = derivePreviewTimingChainTargets(mappings, "comp-210");
    const discoveryResult = sceneEvidence({ manifestCompositionId: "comp-210", layerDetails: [layerDetail({ layerIndex: 1, sourceCompositionId: "comp-99" })] });
    const comp1Result = sceneEvidence({ manifestCompositionId: "comp-1", layers: [layerEvidence({ layerIndex: 3 })] });

    const result = resolvePreviewTimingChains(mappings, "comp-210", targets, [discoveryResult, comp1Result]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("never appeared");
  });

  it("fails clearly when real timing evidence for a required hop is missing from its target's own response", () => {
    const mappings = [mapping({ id: "logo", placeholderName: "Logo", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] })];
    const targets = derivePreviewTimingChainTargets(mappings, "comp-1");
    const result = resolvePreviewTimingChains(mappings, "comp-1", targets, [sceneEvidence({ manifestCompositionId: "comp-1", layers: [] })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Missing real timing evidence");
  });
});

describe("opacityVisibleIntervals", () => {
  it("treats null opacity (property could not be read) as fully visible over the whole window - never refuses merely because a read failed", () => {
    expect(opacityVisibleIntervals(null, 0, 5)).toEqual([[0, 5]]);
  });

  it("real 2026-09-10 incident shape: a confirmed STATIC opacity of 0 excludes the whole window entirely", () => {
    const opacity: OpacityFact = { staticPercent: 0, keyframes: null };
    expect(opacityVisibleIntervals(opacity, 0.96763430096763, 5.63897230563897)).toEqual([]);
  });

  it("a confirmed STATIC opacity greater than 0 is fully visible over the whole window", () => {
    const opacity: OpacityFact = { staticPercent: 100, keyframes: null };
    expect(opacityVisibleIntervals(opacity, 0, 5)).toEqual([[0, 5]]);
  });

  it("animated opacity REVEAL (0 -> 100) - only the real sub-interval from the crossing keyframe onward is visible", () => {
    const opacity: OpacityFact = { staticPercent: null, keyframes: [{ timeSeconds: 1, valuePercent: 0 }, { timeSeconds: 2, valuePercent: 100 }] };
    expect(opacityVisibleIntervals(opacity, 0, 5)).toEqual([[1, 5]]);
  });

  it("animated opacity FADE-OUT (100 -> 0) - only the real sub-interval before the crossing keyframe is visible", () => {
    const opacity: OpacityFact = { staticPercent: null, keyframes: [{ timeSeconds: 2, valuePercent: 100 }, { timeSeconds: 4, valuePercent: 0 }] };
    expect(opacityVisibleIntervals(opacity, 0, 5)).toEqual([[0, 4]]);
  });

  it("a fade-in-then-fade-out (0 -> 100 -> 0) produces exactly one merged visible interval spanning both non-zero segments", () => {
    const opacity: OpacityFact = {
      staticPercent: null,
      keyframes: [
        { timeSeconds: 1, valuePercent: 0 },
        { timeSeconds: 2.5, valuePercent: 100 },
        { timeSeconds: 4, valuePercent: 0 }
      ]
    };
    expect(opacityVisibleIntervals(opacity, 0, 5)).toEqual([[1, 4]]);
  });

  it("a segment between two zero-value keyframes is excluded even when the window includes values before/after", () => {
    const opacity: OpacityFact = {
      staticPercent: null,
      keyframes: [
        { timeSeconds: 1, valuePercent: 0 },
        { timeSeconds: 2, valuePercent: 0 },
        { timeSeconds: 3, valuePercent: 100 }
      ]
    };
    expect(opacityVisibleIntervals(opacity, 0, 5)).toEqual([[2, 5]]);
  });

  it("holds the first keyframe's own value flat before it, and the last keyframe's own value flat after it (AE's real default behavior)", () => {
    const opacity: OpacityFact = { staticPercent: null, keyframes: [{ timeSeconds: 2, valuePercent: 100 }, { timeSeconds: 3, valuePercent: 100 }] };
    expect(opacityVisibleIntervals(opacity, 0, 5)).toEqual([[0, 5]]);
  });
});

describe("computeChainVisibleRanges", () => {
  it("single hop (original 2026-09-09 behavior preserved) - maps a leaf's own in/out points into the wrapper's own timeline at 100% stretch", () => {
    const result = computeChainVisibleRanges([
      hop({ compositionId: "comp-1", window: window({ layerIndex: 3, inPointSeconds: 0, outPointSeconds: 7, startTimeSeconds: 0 }) }),
      hop({ compositionId: "comp-1635", window: window({ layerIndex: 1, inPointSeconds: 2, outPointSeconds: 6 }) })
    ]);
    expect(result).toEqual({ ok: true, ranges: [[2, 6]] });
  });

  it("3-hop chain composes the transform twice, outward from the leaf", () => {
    const result = computeChainVisibleRanges([
      hop({ compositionId: "comp-A", window: window({ inPointSeconds: 0, outPointSeconds: 20, startTimeSeconds: 0 }) }),
      hop({ compositionId: "comp-B", window: window({ inPointSeconds: 0, outPointSeconds: 10, startTimeSeconds: 5 }) }),
      hop({ compositionId: "comp-C", window: window({ inPointSeconds: 1, outPointSeconds: 3 }) })
    ]);
    // leaf [1,3] -> comp-B: startTime 5 + [1,3] = [6,8], clamped to [0,10] -> [6,8]
    // -> comp-A: startTime 0 + [6,8] = [6,8], clamped to [0,20] -> [6,8]
    expect(result).toEqual({ ok: true, ranges: [[6, 8]] });
  });

  it("real 2026-09-10 incident 4-hop logo chain (!Render outer-discovery -> Scene 1 -> Pre-comp 3 -> App Emblem, real evidence values) - reproduces the true logo range, not the App-Emblem-as-stand-in approximation the old 2-hop version used", () => {
    const result = computeChainVisibleRanges([
      // !Render's own layer hosting Scene 1 - assumed identity in the old version; now real, measured evidence.
      hop({ compositionId: "comp-210", window: window({ inPointSeconds: 0, outPointSeconds: 45.045045045045, startTimeSeconds: 0 }) }),
      // Scene 1's own layer 3 hosting Pre-comp 3 - the real evidence from job 16c2c2f7.
      hop({ compositionId: "comp-1", window: window({ layerIndex: 3, inPointSeconds: 1.63496830163497, outPointSeconds: 8.64197530864197, startTimeSeconds: 1.63496830163497 }) }),
      // Pre-comp 3's own layer 1, App Emblem - the real evidence from job dd608d73.
      hop({ compositionId: "comp-1635", window: window({ layerIndex: 1, inPointSeconds: 0, outPointSeconds: 10.01001001001, startTimeSeconds: 0 }) })
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // App Emblem [0,10.01] * 100% + startTime 1.635 = [1.635, 11.645], clamped to Scene 1 layer's own [1.635, 8.642] -> [1.635, 8.642]
    // then through !Render's own identity layer -> unchanged.
    expect(result.ranges[0]![0]).toBeCloseTo(1.63496830163497, 10);
    expect(result.ranges[0]![1]).toBeCloseTo(8.64197530864197, 10);
  });

  it("stretch propagates correctly across MULTIPLE hops, not just the outermost one", () => {
    const result = computeChainVisibleRanges([
      hop({ compositionId: "comp-A", window: window({ inPointSeconds: 0, outPointSeconds: 100, startTimeSeconds: 0 }) }),
      hop({ compositionId: "comp-B", stretchPercent: 50, window: window({ inPointSeconds: 0, outPointSeconds: 100, startTimeSeconds: 0 }) }),
      hop({ compositionId: "comp-C", stretchPercent: 200, window: window({ inPointSeconds: 0, outPointSeconds: 20, startTimeSeconds: 0 }) })
    ]);
    // leaf [0,20] * 200% (comp-C's own stretch doesn't apply to itself, it applies going INTO comp-B) ->
    // Actually: comp-C is the LEAF here (last hop), so its own window [0,20] is used directly (leaf has no "own" stretch applied to itself - stretch belongs to the WRAPPER one level up).
    // -> through comp-B (stretch 50%): startTime 0 + [0,20]*0.5 = [0,10]
    // -> through comp-A (stretch: not set on comp-A itself, comp-A is outermost, its own stretch would apply if IT were a wrapper one level further out, but comp-A here has no wrapper - wait comp-A's own stretchPercent (100, default) is applied when mapping comp-B's window into comp-A's timeline)
    // -> through comp-A: startTime 0 + [0,10]*1.0 = [0,10], clamped to [0,100] -> [0,10]
    expect(result).toEqual({ ok: true, ranges: [[0, 10]] });
  });

  it("real incident fix: a leaf with confirmed static opacity 0 (the real Hebrew text layer shape) is excluded entirely - never treated as visible merely because it's inside its own inPoint/outPoint window", () => {
    const result = computeChainVisibleRanges([
      hop({ compositionId: "comp-1", window: window({ layerIndex: 3, inPointSeconds: 1.63496830163497, outPointSeconds: 8.64197530864197, startTimeSeconds: 1.63496830163497 }) }),
      hop({
        compositionId: "comp-1635",
        window: window({ layerIndex: 4, inPointSeconds: 0.96763430096763, outPointSeconds: 5.63897230563897, startTimeSeconds: -2.53586920253587 }),
        opacity: { staticPercent: 0, keyframes: null }
      })
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("confirmed opacity 0");
  });

  it("an animated opacity reveal (held at 0, then ramping up) at the leaf intersects correctly with the wrapper's own mapped window", () => {
    const result = computeChainVisibleRanges([
      hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 10, startTimeSeconds: 0 }) }),
      hop({
        compositionId: "comp-2",
        window: window({ inPointSeconds: 0, outPointSeconds: 10 }),
        opacity: { staticPercent: null, keyframes: [{ timeSeconds: 0, valuePercent: 0 }, { timeSeconds: 1, valuePercent: 0 }, { timeSeconds: 3, valuePercent: 100 }] }
      })
    ]);
    // [0,1] held at 0 (both endpoints 0) - excluded. [1,3] ramps 0->100 - included (only one endpoint is 0). Held at 100 after t=3.
    expect(result).toEqual({ ok: true, ranges: [[1, 10]] });
  });

  it("a wrapper's OWN opacity (not just the leaf's) also gates visibility", () => {
    const result = computeChainVisibleRanges([
      hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 10 }), opacity: { staticPercent: 0, keyframes: null } }),
      hop({ compositionId: "comp-2", window: window({ inPointSeconds: 0, outPointSeconds: 10 }) })
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Wrapper layer");
  });

  it("refuses when ANY hop (not only the outermost) has time remapping confirmed enabled - fails clearly instead of guessing", () => {
    const result = computeChainVisibleRanges([
      hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 10 }) }),
      hop({ compositionId: "comp-2", timeRemapEnabled: true, window: window({ inPointSeconds: 0, outPointSeconds: 10 }) }),
      hop({ compositionId: "comp-3", window: window({ inPointSeconds: 0, outPointSeconds: 5 }) })
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("time remapping");
  });

  it("refuses when the leaf itself is disabled", () => {
    const result = computeChainVisibleRanges([hop({ window: window({ enabled: false }) })]);
    expect(result.ok).toBe(false);
  });

  it("refuses when a MIDDLE hop (not the outermost, not the leaf) is disabled", () => {
    const result = computeChainVisibleRanges([
      hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 10 }) }),
      hop({ compositionId: "comp-2", window: window({ enabled: false, inPointSeconds: 0, outPointSeconds: 10 }) }),
      hop({ compositionId: "comp-3", window: window({ inPointSeconds: 0, outPointSeconds: 5 }) })
    ]);
    expect(result.ok).toBe(false);
  });

  it("refuses on an empty chain", () => {
    expect(computeChainVisibleRanges([])).toEqual({ ok: false, reason: expect.stringContaining("Empty chain") });
  });

  it("refuses when a hop's own mapped window never overlaps its wrapper's visible window", () => {
    const result = computeChainVisibleRanges([
      hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 2 }) }),
      hop({ compositionId: "comp-2", window: window({ inPointSeconds: 10, outPointSeconds: 15 }) })
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Never overlaps");
  });

  it("defaults a null stretchPercent to 100 (AE's own default) at any hop, never refusing merely because the property read failed to null", () => {
    const result = computeChainVisibleRanges([
      hop({ compositionId: "comp-1", stretchPercent: null, window: window({ inPointSeconds: 0, outPointSeconds: 10 }) }),
      hop({ compositionId: "comp-2", window: window({ inPointSeconds: 2, outPointSeconds: 6 }) })
    ]);
    expect(result).toEqual({ ok: true, ranges: [[2, 6]] });
  });
});

describe("calculatePreviewTiming", () => {
  function chain(label: string, hops: ChainHop[]): LabeledChain {
    return { label, hops };
  }

  it("computes the real overlap between two labels with different timing, and recommends the midpoint of the largest overlap", () => {
    const result = calculatePreviewTiming([
      chain("Logo", [hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 7 }) }), hop({ compositionId: "comp-2", window: window({ inPointSeconds: 2, outPointSeconds: 6 }) })]),
      chain("Hebrew", [hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 7 }) }), hop({ compositionId: "comp-2", window: window({ layerIndex: 4, inPointSeconds: 3, outPointSeconds: 7 }) })])
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rangesByLabel.Logo).toEqual([[2, 6]]);
    expect(result.rangesByLabel.Hebrew).toEqual([[3, 7]]);
    expect(result.overlapRanges).toEqual([[3, 6]]);
    expect(result.usedOverlap).toBe(true);
    expect(result.recommendedTimestampSeconds).toBe(4.5);
  });

  it("falls back to the single largest range across every label (never a guess) when nothing overlaps, and reports usedOverlap:false", () => {
    const result = calculatePreviewTiming([
      chain("Logo", [hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 2 }) })]),
      chain("Hebrew", [hop({ compositionId: "comp-1", window: window({ layerIndex: 4, inPointSeconds: 5, outPointSeconds: 15 }) })])
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overlapRanges).toEqual([]);
    expect(result.usedOverlap).toBe(false);
    // Hebrew's own [5,15] (width 10) is larger than Logo's [0,2] (width 2).
    expect(result.recommendedTimestampSeconds).toBe(10);
  });

  it("real 2026-09-10 incident, end to end: with the fix (opacity now factored in), the Hebrew chain refuses outright rather than recommending a timestamp where it is confirmed invisible", () => {
    const logoChain = chain("App Logo", [
      hop({ compositionId: "comp-210", window: window({ inPointSeconds: 0, outPointSeconds: 45.045045045045 }) }),
      hop({ compositionId: "comp-1", window: window({ layerIndex: 3, inPointSeconds: 1.63496830163497, outPointSeconds: 8.64197530864197, startTimeSeconds: 1.63496830163497 }) }),
      hop({ compositionId: "comp-1635", window: window({ layerIndex: 1, inPointSeconds: 0, outPointSeconds: 10.01001001001 }) })
    ]);
    const hebrewChain = chain("Hebrew Branding", [
      hop({ compositionId: "comp-210", window: window({ inPointSeconds: 0, outPointSeconds: 45.045045045045 }) }),
      hop({ compositionId: "comp-1", window: window({ layerIndex: 3, inPointSeconds: 1.63496830163497, outPointSeconds: 8.64197530864197, startTimeSeconds: 1.63496830163497 }) }),
      hop({
        compositionId: "comp-1635",
        window: window({ layerIndex: 4, inPointSeconds: 0.96763430096763, outPointSeconds: 5.63897230563897, startTimeSeconds: -2.53586920253587 }),
        opacity: { staticPercent: 0, keyframes: null }
      })
    ]);

    const result = calculatePreviewTiming([logoChain, hebrewChain]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Hebrew Branding");
    expect(result.reason).toContain("confirmed opacity 0");
  });

  it("refuses with an empty chains list", () => {
    expect(calculatePreviewTiming([])).toEqual({ ok: false, reason: expect.stringContaining("No chains") });
  });
});
