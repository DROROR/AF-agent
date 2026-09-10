import { describe, expect, it } from "vitest";
import { MAX_PREVIEW_TIMING_CHAIN_TARGETS, type PlaceholderMapping, type ScenePlanEntry } from "@dyo/schemas";
import { derivePreviewTimingTargets } from "../derive-preview-timing-targets.js";

const NOW = new Date("2026-09-09T00:00:00.000Z").toISOString();

function mapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
  return {
    id: "mapping-1",
    manifestPlaceholderId: null,
    placeholderName: "test",
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function scene(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-210",
    compositionName: "!Render",
    use: true,
    sourcePosition: 0,
    finalOrder: 0,
    finalDuration: null,
    approvalState: "APPROVED",
    instructions: null,
    notes: null,
    unresolvedReasons: [],
    evidence: [],
    mappings: [],
    reelsLayout: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

describe("derivePreviewTimingTargets", () => {
  it("derives the FULL real-incident chain (2026-09-10 extension) - all four logo hops (comp-1/comp-1635/comp-1044/comp-1113) and both Hebrew hops, no outer-discovery prepend (that is now a separate, adaptive mechanism)", () => {
    const logoMapping = mapping({
      id: "logo",
      humanNestedTarget: [
        { compositionId: "comp-1", layerIndex: 3 },
        { compositionId: "comp-1635", layerIndex: 1 },
        { compositionId: "comp-1044", layerIndex: 1 },
        { compositionId: "comp-1113", layerIndex: 1 }
      ]
    });
    const hebrewMapping = mapping({
      id: "hebrew",
      humanNestedTarget: [
        { compositionId: "comp-1", layerIndex: 3 },
        { compositionId: "comp-1635", layerIndex: 4 }
      ]
    });

    const result = derivePreviewTimingTargets(scene({ mappings: [logoMapping, hebrewMapping] }));

    expect(result).toEqual([
      { compositionId: "comp-1", layerIndices: [3] },
      { compositionId: "comp-1635", layerIndices: [1, 4] },
      { compositionId: "comp-1044", layerIndices: [1] },
      { compositionId: "comp-1113", layerIndices: [1] }
    ]);
  });

  it("returns an empty array when no mapping has a nested target (all same-composition mappings)", () => {
    const result = derivePreviewTimingTargets(scene({ mappings: [mapping({ humanNestedTarget: null })] }));
    expect(result).toEqual([]);
  });

  it("deduplicates layer indices across multiple mappings sharing the same first hop, without duplicating the composition entry", () => {
    const mappingA = mapping({ id: "a", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] });
    const mappingB = mapping({ id: "b", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] });

    const result = derivePreviewTimingTargets(scene({ mappings: [mappingA, mappingB] }));

    expect(result).toEqual([{ compositionId: "comp-1", layerIndices: [3] }]);
  });

  it("walks the COMPLETE chain depth by default - no maxHops limit, deeper compositions (comp-1044) are always included", () => {
    const logoMapping = mapping({
      id: "logo",
      humanNestedTarget: [
        { compositionId: "comp-1", layerIndex: 3 },
        { compositionId: "comp-1635", layerIndex: 1 },
        { compositionId: "comp-1044", layerIndex: 1 }
      ]
    });

    const result = derivePreviewTimingTargets(scene({ mappings: [logoMapping] }));

    expect(result).toEqual([
      { compositionId: "comp-1", layerIndices: [3] },
      { compositionId: "comp-1635", layerIndices: [1] },
      { compositionId: "comp-1044", layerIndices: [1] }
    ]);
  });

  it("supports an arbitrary 6-hop chain end to end - never hardcoded to any specific template's own real depth", () => {
    const deepMapping = mapping({
      id: "deep",
      humanNestedTarget: [
        { compositionId: "comp-A", layerIndex: 1 },
        { compositionId: "comp-B", layerIndex: 2 },
        { compositionId: "comp-C", layerIndex: 3 },
        { compositionId: "comp-D", layerIndex: 4 },
        { compositionId: "comp-E", layerIndex: 5 },
        { compositionId: "comp-F", layerIndex: 6 }
      ]
    });

    const result = derivePreviewTimingTargets(scene({ mappings: [deepMapping] }));

    expect(result.map((t) => t.compositionId)).toEqual(["comp-A", "comp-B", "comp-C", "comp-D", "comp-E", "comp-F"]);
  });

  it("bounds the total target count at MAX_PREVIEW_TIMING_CHAIN_TARGETS, even for a pathologically deep/wide chain", () => {
    const hops = Array.from({ length: MAX_PREVIEW_TIMING_CHAIN_TARGETS + 10 }, (_, i) => ({ compositionId: `comp-${i}`, layerIndex: 1 }));
    const wideMapping = mapping({ id: "wide", humanNestedTarget: hops });

    const result = derivePreviewTimingTargets(scene({ mappings: [wideMapping] }));

    expect(result.length).toBe(MAX_PREVIEW_TIMING_CHAIN_TARGETS);
  });
});
