import { describe, expect, it } from "vitest";
import type { PlaceholderMapping } from "@dyo/schemas";
import { calculateBrandingVisibility, deriveNestedTargetHops, type LayerWindow } from "./preview-timing";

function window(overrides: Partial<LayerWindow> = {}): LayerWindow {
  return { layerIndex: 1, enabled: true, inPointSeconds: 0, outPointSeconds: 5, startTimeSeconds: 0, ...overrides };
}

const NOW_ISO = "2026-09-09T00:00:00.000Z";
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

describe("deriveNestedTargetHops", () => {
  it("derives the real 2026-09-08/09 incident shape: comp-1[3] wrapper, comp-1635 inner, Logo+Hebrew leaves with their own real placeholderName labels", () => {
    const result = deriveNestedTargetHops([
      mapping({
        id: "logo",
        placeholderName: "App Logo (workshop_logo__.png)",
        humanNestedTarget: [
          { compositionId: "comp-1", layerIndex: 3 },
          { compositionId: "comp-1635", layerIndex: 1 },
          { compositionId: "comp-1044", layerIndex: 1 }
        ]
      }),
      mapping({
        id: "hebrew",
        placeholderName: "DYO Hebrew Branding",
        humanNestedTarget: [
          { compositionId: "comp-1", layerIndex: 3 },
          { compositionId: "comp-1635", layerIndex: 4 }
        ]
      })
    ]);

    expect(result).toEqual({
      wrapperCompositionId: "comp-1",
      wrapperLayerIndex: 3,
      innerCompositionId: "comp-1635",
      leaves: [
        { label: "App Logo (workshop_logo__.png)", layerIndex: 1 },
        { label: "DYO Hebrew Branding", layerIndex: 4 }
      ]
    });
  });

  it("returns null when no mapping has a real two-hop nested target", () => {
    expect(deriveNestedTargetHops([mapping({ humanNestedTarget: null }), mapping({ humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] })])).toBeNull();
  });

  it("skips a mapping whose first two hops disagree with the already-established shared wrapper/inner pair, rather than fabricating a second analysis", () => {
    const result = deriveNestedTargetHops([
      mapping({ id: "a", placeholderName: "A", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }, { compositionId: "comp-1635", layerIndex: 1 }] }),
      mapping({ id: "b", placeholderName: "B", humanNestedTarget: [{ compositionId: "comp-2", layerIndex: 9 }, { compositionId: "comp-999", layerIndex: 2 }] })
    ]);
    expect(result?.leaves).toEqual([{ label: "A", layerIndex: 1 }]);
  });

  it("falls back to a generic label only when placeholderName is genuinely null - never fabricates a descriptive name", () => {
    const result = deriveNestedTargetHops([
      mapping({ id: "mapping-x", placeholderName: null, humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }, { compositionId: "comp-1635", layerIndex: 1 }] })
    ]);
    expect(result?.leaves).toEqual([{ label: "Mapping mapping-x", layerIndex: 1 }]);
  });
});

describe("calculateBrandingVisibility", () => {
  it("maps a leaf layer's local in/out points into the outer composition's absolute time at 100% stretch (no time distortion)", () => {
    const result = calculateBrandingVisibility({
      outerLayer: window({ layerIndex: 3, inPointSeconds: 0, outPointSeconds: 7, startTimeSeconds: 0 }),
      outerLayerStretchPercent: 100,
      outerLayerTimeRemapEnabled: false,
      leafLayers: [{ label: "Logo", window: window({ layerIndex: 1, inPointSeconds: 2, outPointSeconds: 6 }) }]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rangesByLabel.Logo).toEqual([2, 6]);
  });

  it("accounts for the wrapper layer's own real stretch percentage (e.g. 50% = the nested comp plays at double real-time speed)", () => {
    const result = calculateBrandingVisibility({
      outerLayer: window({ layerIndex: 3, inPointSeconds: 0, outPointSeconds: 10, startTimeSeconds: 0 }),
      outerLayerStretchPercent: 50,
      outerLayerTimeRemapEnabled: false,
      leafLayers: [{ label: "Logo", window: window({ layerIndex: 1, inPointSeconds: 2, outPointSeconds: 6 }) }]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // local [2,6] * 0.5 stretch = outer [1,3]
    expect(result.rangesByLabel.Logo).toEqual([1, 3]);
  });

  it("offsets by the wrapper layer's own startTimeSeconds - the nested comp's local time 0 aligns to the wrapper's startTime, never the outer composition's absolute 0", () => {
    const result = calculateBrandingVisibility({
      outerLayer: window({ layerIndex: 3, inPointSeconds: 1, outPointSeconds: 8, startTimeSeconds: 1 }),
      outerLayerStretchPercent: 100,
      outerLayerTimeRemapEnabled: false,
      leafLayers: [{ label: "Logo", window: window({ layerIndex: 1, inPointSeconds: 2, outPointSeconds: 6 }) }]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // startTime=1 + local[2,6] = outer [3,7]
    expect(result.rangesByLabel.Logo).toEqual([3, 7]);
  });

  it("clamps to the wrapper layer's own visible window - nothing nested inside it can be visible before/after the wrapper's own inPoint/outPoint", () => {
    const result = calculateBrandingVisibility({
      outerLayer: window({ layerIndex: 3, inPointSeconds: 2, outPointSeconds: 5, startTimeSeconds: 0 }),
      outerLayerStretchPercent: 100,
      outerLayerTimeRemapEnabled: false,
      leafLayers: [{ label: "Logo", window: window({ layerIndex: 1, inPointSeconds: 0, outPointSeconds: 10 }) }]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rangesByLabel.Logo).toEqual([2, 5]);
  });

  it("computes the real overlap range between two leaves with different timing (logo vs Hebrew), and recommends its midpoint", () => {
    const result = calculateBrandingVisibility({
      outerLayer: window({ layerIndex: 3, inPointSeconds: 0, outPointSeconds: 7, startTimeSeconds: 0 }),
      outerLayerStretchPercent: 100,
      outerLayerTimeRemapEnabled: false,
      leafLayers: [
        { label: "Logo", window: window({ layerIndex: 1, inPointSeconds: 2, outPointSeconds: 6 }) },
        { label: "Hebrew", window: window({ layerIndex: 4, inPointSeconds: 3, outPointSeconds: 7 }) }
      ]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rangesByLabel.Logo).toEqual([2, 6]);
    expect(result.rangesByLabel.Hebrew).toEqual([3, 7]);
    expect(result.overlapRange).toEqual([3, 6]);
    expect(result.usedOverlap).toBe(true);
    expect(result.recommendedTimestampSeconds).toBe(4.5);
  });

  it("falls back to the first leaf's own range (never a guess) when the two leaves genuinely never overlap, and reports usedOverlap:false", () => {
    const result = calculateBrandingVisibility({
      outerLayer: window({ layerIndex: 3, inPointSeconds: 0, outPointSeconds: 10, startTimeSeconds: 0 }),
      outerLayerStretchPercent: 100,
      outerLayerTimeRemapEnabled: false,
      leafLayers: [
        { label: "Logo", window: window({ layerIndex: 1, inPointSeconds: 0, outPointSeconds: 2 }) },
        { label: "Hebrew", window: window({ layerIndex: 4, inPointSeconds: 5, outPointSeconds: 8 }) }
      ]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overlapRange).toBeNull();
    expect(result.usedOverlap).toBe(false);
    expect(result.recommendedTimestampSeconds).toBe(1);
  });

  it("refuses when the wrapper layer is disabled - never proceeds to compute a number that could never be real", () => {
    const result = calculateBrandingVisibility({
      outerLayer: window({ enabled: false }),
      outerLayerStretchPercent: 100,
      outerLayerTimeRemapEnabled: false,
      leafLayers: [{ label: "Logo", window: window() }]
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("disabled");
  });

  it("refuses when a leaf layer is disabled", () => {
    const result = calculateBrandingVisibility({
      outerLayer: window(),
      outerLayerStretchPercent: 100,
      outerLayerTimeRemapEnabled: false,
      leafLayers: [{ label: "Logo", window: window({ enabled: false }) }]
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("disabled");
  });

  it("refuses outright when the wrapper layer has time remapping enabled - never approximates with linear stretch instead", () => {
    const result = calculateBrandingVisibility({
      outerLayer: window(),
      outerLayerStretchPercent: 100,
      outerLayerTimeRemapEnabled: true,
      leafLayers: [{ label: "Logo", window: window() }]
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("time remapping");
  });

  it("refuses when a leaf's mapped window never actually overlaps the wrapper's own visible window", () => {
    const result = calculateBrandingVisibility({
      outerLayer: window({ inPointSeconds: 0, outPointSeconds: 2 }),
      outerLayerStretchPercent: 100,
      outerLayerTimeRemapEnabled: false,
      leafLayers: [{ label: "Logo", window: window({ inPointSeconds: 10, outPointSeconds: 15 }) }]
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("never overlaps");
  });

  it("defaults a null stretchPercent to 100 (AE's own default) - never refuses merely because the property read failed to a null", () => {
    const result = calculateBrandingVisibility({
      outerLayer: window({ inPointSeconds: 0, outPointSeconds: 10 }),
      outerLayerStretchPercent: null,
      outerLayerTimeRemapEnabled: null,
      leafLayers: [{ label: "Logo", window: window({ inPointSeconds: 2, outPointSeconds: 6 }) }]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rangesByLabel.Logo).toEqual([2, 6]);
  });

  it("refuses when no leaf layers are provided at all", () => {
    const result = calculateBrandingVisibility({
      outerLayer: window(),
      outerLayerStretchPercent: 100,
      outerLayerTimeRemapEnabled: false,
      leafLayers: []
    });
    expect(result.ok).toBe(false);
  });
});
