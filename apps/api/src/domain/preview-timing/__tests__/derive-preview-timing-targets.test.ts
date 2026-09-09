import { describe, expect, it } from "vitest";
import type { PlaceholderMapping, ScenePlanEntry } from "@dyo/schemas";
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
  it("derives exactly the real-incident two targets - comp-1[3] and comp-1635[1,4] - from the logo and Hebrew mappings' own real nested target chains", () => {
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
      { compositionId: "comp-1635", layerIndices: [1, 4] }
    ]);
    // The 4-hop logo chain's deeper compositions (comp-1044/comp-1113) are
    // deliberately excluded by the default maxHops=2 - never silently
    // included.
    expect(result.some((t) => t.compositionId === "comp-1044" || t.compositionId === "comp-1113")).toBe(false);
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

  it("respects a custom maxHops, including deeper compositions when explicitly requested", () => {
    const logoMapping = mapping({
      id: "logo",
      humanNestedTarget: [
        { compositionId: "comp-1", layerIndex: 3 },
        { compositionId: "comp-1635", layerIndex: 1 },
        { compositionId: "comp-1044", layerIndex: 1 }
      ]
    });

    const result = derivePreviewTimingTargets(scene({ mappings: [logoMapping] }), 3);

    expect(result).toEqual([
      { compositionId: "comp-1", layerIndices: [3] },
      { compositionId: "comp-1635", layerIndices: [1] },
      { compositionId: "comp-1044", layerIndices: [1] }
    ]);
  });
});
