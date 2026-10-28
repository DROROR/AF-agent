import { describe, expect, it } from "vitest";
import type { PlaceholderMapping, ScenePlanEntry } from "@dyo/schemas";
import { sceneHasHumanInput } from "./scene-human-input";

function mapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
  return {
    id: "m1",
    manifestPlaceholderId: "p1",
    keepTemplateText: null,
    placeholderName: "Text A",
    placeholderClassification: { value: "text", source: "MANIFEST", evidence: [] },
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
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
    ...overrides
  } as PlaceholderMapping;
}
function scene(mappings: PlaceholderMapping[]): ScenePlanEntry {
  return { id: "s1", manifestCompositionId: "c1", compositionName: "BG Dark", use: true, sourcePosition: 0, finalOrder: 0, finalDuration: null, approvalState: "UNREVIEWED", instructions: null, notes: null, unresolvedReasons: [], evidence: [], mappings, reelsLayout: null, createdAt: "2026-10-28T00:00:00.000Z", updatedAt: "2026-10-28T00:00:00.000Z" } as ScenePlanEntry;
}

describe("sceneHasHumanInput (2026-10-28: 22 untouched scenes locked Approve Scenes)", () => {
  it("is false for a scene the template filled and nobody touched", () => {
    expect(sceneHasHumanInput(scene([mapping(), mapping({ id: "m2", placeholderClassification: { value: "image", source: "MANIFEST", evidence: [] } })]))).toBe(false);
  });
  it("is true once a picture, a text, a colour or a decision is on any of its placeholders", () => {
    expect(sceneHasHumanInput(scene([mapping({ selectedAssetId: "a1" })]))).toBe(true);
    expect(sceneHasHumanInput(scene([mapping({ text: "שלום" })]))).toBe(true);
    expect(sceneHasHumanInput(scene([mapping({ colorHex: "#112233" })]))).toBe(true);
    expect(sceneHasHumanInput(scene([mapping({ keepTemplateText: { decision: "KEEP_TEMPLATE_TEXT", textAtDecision: "x", decidedBy: "u", decidedAt: "2026-10-28T00:00:00.000Z" } as never })]))).toBe(true);
  });
  it("whitespace-only text is not input", () => {
    expect(sceneHasHumanInput(scene([mapping({ text: "   " })]))).toBe(false);
  });
});
