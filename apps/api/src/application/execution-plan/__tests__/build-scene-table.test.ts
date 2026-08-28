import { describe, expect, it } from "vitest";
import type { PlaceholderMapping, ScenePlanEntry } from "@dyo/schemas";
import { buildSceneTable } from "../build-scene-table.js";

const NOW = "2026-08-26T00:00:00.000Z";

function mapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
  return {
    id: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "Headline",
    placeholderClassification: { value: null, source: "MANIFEST", evidence: ["unknown"] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function scene(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene A",
    use: true,
    sourcePosition: 0,
    finalOrder: 0,
    finalDuration: null,
    approvalState: "UNREVIEWED",
    instructions: null,
    notes: null,
    unresolvedReasons: [],
    evidence: [],
    mappings: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

describe("buildSceneTable", () => {
  it("produces one row per mapping when a scene has one or more", () => {
    const rows = buildSceneTable([scene({ mappings: [mapping({ id: "m1" }), mapping({ id: "m2" })] })]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.mappingId)).toEqual(["m1", "m2"]);
  });

  it("produces exactly one row (mappingId: null) for a composition-level-only scene with zero mappings - never dropped", () => {
    const rows = buildSceneTable([scene({ mappings: [], unresolvedReasons: ["no placeholder detected"] })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mappingId).toBeNull();
    expect(rows[0]?.placeholderLabel).toBeNull();
    expect(rows[0]?.placeholderClassification).toBeNull();
    expect(rows[0]?.unresolvedReasons).toEqual(["no placeholder detected"]);
  });

  it("carries scene-level fields (use, sourcePosition, finalOrder, finalDuration, approvalState) onto every row from that scene", () => {
    const rows = buildSceneTable([
      scene({ use: false, sourcePosition: 3, finalOrder: 7, finalDuration: 5, approvalState: "APPROVED", mappings: [mapping()] })
    ]);
    expect(rows[0]).toMatchObject({ use: false, sourcePosition: 3, finalOrder: 7, finalDuration: 5, approvalState: "APPROVED" });
  });

  it("carries mapping-level fields (text, assetTimestamp, selectedAsset*) independently per row", () => {
    const rows = buildSceneTable([
      scene({
        mappings: [
          mapping({ id: "m1", text: "Hello", assetTimestamp: 4.2, selectedAssetId: "asset-1", selectedAssetType: "video" }),
          mapping({ id: "m2" })
        ]
      })
    ]);
    expect(rows[0]).toMatchObject({ mappingId: "m1", text: "Hello", assetTimestamp: 4.2, selectedAssetId: "asset-1", selectedAssetType: "video" });
    expect(rows[1]).toMatchObject({ mappingId: "m2", text: null, assetTimestamp: null, selectedAssetId: null });
  });

  it("preserves scene order across multiple scenes", () => {
    const rows = buildSceneTable([
      scene({ id: "s1", compositionName: "First" }),
      scene({ id: "s2", compositionName: "Second" })
    ]);
    expect(rows.map((r) => r.compositionName)).toEqual(["First", "Second"]);
  });

  it("shows Unknown (null value) when the placeholder classification is unresolved", () => {
    const rows = buildSceneTable([scene({ mappings: [mapping({ placeholderClassification: { value: null, source: "MANIFEST", evidence: ["x"] } })] })]);
    expect(rows[0]?.placeholderClassification?.value).toBeNull();
  });
});
