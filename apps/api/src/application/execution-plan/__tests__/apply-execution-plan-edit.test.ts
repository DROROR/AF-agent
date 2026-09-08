import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type NestedTargetStep, type PlaceholderMapping, type ScenePlanEntry, type TemplateManifest } from "@dyo/schemas";
import { applyExecutionPlanEdit } from "../apply-execution-plan-edit.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const fixedNow = () => NOW;

/**
 * The exact real confirmed chain live QA traced for this project's
 * branding blocker: !Render > Scene 1 > Pre-comp 3 > App Emblem >
 * App Logo > layer 1 (workshop_logo__.png) - comp-render is the owning
 * scene's own manifestCompositionId (scene()'s default below).
 */
function nestedTargetManifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW.toISOString(),
    compositions: [
      { compositionId: "comp-render", aeProjectItemIndex: 2, name: "!Render", widthPx: 1920, heightPx: 1080, durationSeconds: 45, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] },
      { compositionId: "comp-scene1", aeProjectItemIndex: 48, name: "Scene 1", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-render"] },
      { compositionId: "comp-precomp3", aeProjectItemIndex: 45, name: "Pre-comp 3", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-scene1"] },
      { compositionId: "comp-emblem", aeProjectItemIndex: 34, name: "App Emblem", widthPx: 500, heightPx: 500, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-precomp3"] },
      { compositionId: "comp-logo", aeProjectItemIndex: 31, name: "App Logo", widthPx: 500, heightPx: 500, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-emblem"] },
      // A composition that is NOT actually a child of comp-scene1 (its real
      // parent is comp-render directly) - used to prove a broken/invalid
      // link is caught, never accepted on trust.
      { compositionId: "comp-unrelated", aeProjectItemIndex: 99, name: "Unrelated Comp", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-render"] }
    ],
    scenes: [],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

/** The real confirmed path: within Scene 1 layer 5 references Pre-comp 3, within Pre-comp 3 layer 2 references App Emblem, within App Emblem layer 3 references App Logo, and within App Logo layer 1 IS workshop_logo__.png. */
const REAL_LOGO_NESTED_TARGET: NestedTargetStep[] = [
  { compositionId: "comp-scene1", layerIndex: 5 },
  { compositionId: "comp-precomp3", layerIndex: 2 },
  { compositionId: "comp-emblem", layerIndex: 3 },
  { compositionId: "comp-logo", layerIndex: 1 }
];

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
    humanLayerIndex: null,
    humanNestedTarget: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
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
    mappings: [mapping()],
    reelsLayout: null,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    ...overrides
  };
}

describe("applyExecutionPlanEdit", () => {
  it("rejects an operation referencing an unknown scenePlanId", () => {
    const result = applyExecutionPlanEdit([scene()], { type: "INCLUDE_SCENE", scenePlanId: "does-not-exist" }, fixedNow);
    expect(result.ok).toBe(false);
  });

  it("rejects an operation referencing an unknown mappingId", () => {
    const result = applyExecutionPlanEdit(
      [scene()],
      { type: "SET_TEXT", scenePlanId: "scene-1", mappingId: "does-not-exist", text: "hi" },
      fixedNow
    );
    expect(result.ok).toBe(false);
  });

  it("INCLUDE_SCENE / EXCLUDE_SCENE toggle use and bump updatedAt", () => {
    const excluded = applyExecutionPlanEdit([scene({ use: true })], { type: "EXCLUDE_SCENE", scenePlanId: "scene-1" }, fixedNow);
    expect(excluded.ok && excluded.scenePlans[0]?.use).toBe(false);
    expect(excluded.ok && excluded.scenePlans[0]?.updatedAt).toBe(NOW.toISOString());

    const included = applyExecutionPlanEdit([scene({ use: false })], { type: "INCLUDE_SCENE", scenePlanId: "scene-1" }, fixedNow);
    expect(included.ok && included.scenePlans[0]?.use).toBe(true);
  });

  it("SET_FINAL_ORDER reorders output independently of sourcePosition", () => {
    const result = applyExecutionPlanEdit([scene({ sourcePosition: 0, finalOrder: 0 })], { type: "SET_FINAL_ORDER", scenePlanId: "scene-1", finalOrder: 9 }, fixedNow);
    expect(result.ok && result.scenePlans[0]?.finalOrder).toBe(9);
    expect(result.ok && result.scenePlans[0]?.sourcePosition).toBe(0);
  });

  it("rejects SET_FINAL_ORDER when the order is already used by another INCLUDED scene", () => {
    const scenes = [scene({ id: "s1", use: true, finalOrder: 0 }), scene({ id: "s2", use: true, finalOrder: 1 })];
    const result = applyExecutionPlanEdit(scenes, { type: "SET_FINAL_ORDER", scenePlanId: "s1", finalOrder: 1 }, fixedNow);
    expect(result.ok).toBe(false);
  });

  it("allows a duplicate finalOrder among EXCLUDED scenes (not prohibited there)", () => {
    const scenes = [scene({ id: "s1", use: true, finalOrder: 0 }), scene({ id: "s2", use: false, finalOrder: 1 })];
    const result = applyExecutionPlanEdit(scenes, { type: "SET_FINAL_ORDER", scenePlanId: "s2", finalOrder: 0 }, fixedNow);
    expect(result.ok).toBe(true);
  });

  it("MAP_ASSET / CLEAR_ASSET set and clear selectedAssetId/selectedAssetType on the exact mapping", () => {
    const mapped = applyExecutionPlanEdit(
      [scene()],
      { type: "MAP_ASSET", scenePlanId: "scene-1", mappingId: "mapping-1", selectedAssetId: "asset-9", selectedAssetType: "video" },
      fixedNow
    );
    expect(mapped.ok && mapped.scenePlans[0]?.mappings[0]?.selectedAssetId).toBe("asset-9");
    expect(mapped.ok && mapped.scenePlans[0]?.mappings[0]?.selectedAssetType).toBe("video");

    const cleared = applyExecutionPlanEdit(
      [scene({ mappings: [mapping({ selectedAssetId: "asset-9", selectedAssetType: "video" })] })],
      { type: "CLEAR_ASSET", scenePlanId: "scene-1", mappingId: "mapping-1" },
      fixedNow
    );
    expect(cleared.ok && cleared.scenePlans[0]?.mappings[0]?.selectedAssetId).toBeNull();
    expect(cleared.ok && cleared.scenePlans[0]?.mappings[0]?.selectedAssetType).toBeNull();
  });

  it("SET_TEXT / CLEAR_TEXT", () => {
    const set = applyExecutionPlanEdit([scene()], { type: "SET_TEXT", scenePlanId: "scene-1", mappingId: "mapping-1", text: "Hello" }, fixedNow);
    expect(set.ok && set.scenePlans[0]?.mappings[0]?.text).toBe("Hello");

    const cleared = applyExecutionPlanEdit(
      [scene({ mappings: [mapping({ text: "Hello" })] })],
      { type: "CLEAR_TEXT", scenePlanId: "scene-1", mappingId: "mapping-1" },
      fixedNow
    );
    expect(cleared.ok && cleared.scenePlans[0]?.mappings[0]?.text).toBeNull();
  });

  it("SET_ASSET_TIMESTAMP / CLEAR_ASSET_TIMESTAMP - independent of finalDuration", () => {
    const set = applyExecutionPlanEdit(
      [scene({ finalDuration: 5 })],
      { type: "SET_ASSET_TIMESTAMP", scenePlanId: "scene-1", mappingId: "mapping-1", assetTimestamp: 12.4 },
      fixedNow
    );
    expect(set.ok && set.scenePlans[0]?.mappings[0]?.assetTimestamp).toBe(12.4);
    expect(set.ok && set.scenePlans[0]?.finalDuration).toBe(5);

    const cleared = applyExecutionPlanEdit(
      [scene({ mappings: [mapping({ assetTimestamp: 12.4 })] })],
      { type: "CLEAR_ASSET_TIMESTAMP", scenePlanId: "scene-1", mappingId: "mapping-1" },
      fixedNow
    );
    expect(cleared.ok && cleared.scenePlans[0]?.mappings[0]?.assetTimestamp).toBeNull();
  });

  it("SET_FINAL_DURATION / CLEAR_FINAL_DURATION - independent of assetTimestamp", () => {
    const set = applyExecutionPlanEdit([scene()], { type: "SET_FINAL_DURATION", scenePlanId: "scene-1", finalDuration: 6.5 }, fixedNow);
    expect(set.ok && set.scenePlans[0]?.finalDuration).toBe(6.5);

    const cleared = applyExecutionPlanEdit([scene({ finalDuration: 6.5 })], { type: "CLEAR_FINAL_DURATION", scenePlanId: "scene-1" }, fixedNow);
    expect(cleared.ok && cleared.scenePlans[0]?.finalDuration).toBeNull();
  });

  it("SET_INSTRUCTIONS / CLEAR_INSTRUCTIONS", () => {
    const set = applyExecutionPlanEdit([scene()], { type: "SET_INSTRUCTIONS", scenePlanId: "scene-1", instructions: "crop center" }, fixedNow);
    expect(set.ok && set.scenePlans[0]?.instructions).toBe("crop center");

    const cleared = applyExecutionPlanEdit([scene({ instructions: "crop center" })], { type: "CLEAR_INSTRUCTIONS", scenePlanId: "scene-1" }, fixedNow);
    expect(cleared.ok && cleared.scenePlans[0]?.instructions).toBeNull();
  });

  it("APPROVE_SCENE sets approvalState to APPROVED", () => {
    const result = applyExecutionPlanEdit([scene()], { type: "APPROVE_SCENE", scenePlanId: "scene-1" }, fixedNow);
    expect(result.ok && result.scenePlans[0]?.approvalState).toBe("APPROVED");
  });

  it("REJECT_SCENE sets approvalState to REJECTED and merges the reason into notes", () => {
    const result = applyExecutionPlanEdit([scene({ notes: "existing note" })], { type: "REJECT_SCENE", scenePlanId: "scene-1", reason: "wrong asset" }, fixedNow);
    expect(result.ok && result.scenePlans[0]?.approvalState).toBe("REJECTED");
    expect(result.ok && result.scenePlans[0]?.notes).toBe("existing note\nwrong asset");
  });

  it("SET_REELS_LAYOUT sets the scene's own reelsLayout from the browser's approved intent, unchanged", () => {
    const layerTransforms = [{ layerIndex: 2, manifestPlaceholderId: "ph-1", positionX: 540, positionY: 960, scalePercent: 150 }];
    const result = applyExecutionPlanEdit(
      [scene()],
      { type: "SET_REELS_LAYOUT", scenePlanId: "scene-1", reelsCompositionName: "Scene A - Reels", layerTransforms },
      fixedNow
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenePlans[0]?.reelsLayout).toEqual({ reelsCompositionName: "Scene A - Reels", layerTransforms, configuredAt: NOW.toISOString() });
  });

  it("CLEAR_REELS_LAYOUT resets the scene's own reelsLayout to null", () => {
    const layerTransforms = [{ layerIndex: 2, manifestPlaceholderId: "ph-1", positionX: 540, positionY: 960, scalePercent: 150 }];
    const withLayout = scene({ reelsLayout: { reelsCompositionName: "Scene A - Reels", layerTransforms, configuredAt: NOW.toISOString() } });
    const result = applyExecutionPlanEdit([withLayout], { type: "CLEAR_REELS_LAYOUT", scenePlanId: "scene-1" }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenePlans[0]?.reelsLayout).toBeNull();
  });

  it("never mutates the input array/objects - returns a new structure", () => {
    const original = [scene()];
    const originalMapping = original[0]?.mappings[0];
    applyExecutionPlanEdit(original, { type: "SET_TEXT", scenePlanId: "scene-1", mappingId: "mapping-1", text: "Hello" }, fixedNow);
    expect(original[0]?.mappings[0]).toBe(originalMapping);
    expect(original[0]?.mappings[0]?.text).toBeNull();
  });

  describe("SET_BRAND_COLOR / CLEAR_BRAND_COLOR", () => {
    it("sets the normalized #RRGGBB colorHex on a color-classified mapping", () => {
      const colorScene = scene({ mappings: [mapping({ placeholderClassification: { value: "color", source: "MANIFEST", evidence: [] } })] });
      const result = applyExecutionPlanEdit([colorScene], { type: "SET_BRAND_COLOR", scenePlanId: "scene-1", mappingId: "mapping-1", colorHex: "#1a2b3c" }, fixedNow);
      expect(result.ok).toBe(true);
      expect(result.ok && result.scenePlans[0]?.mappings[0]?.colorHex).toBe("#1A2B3C");
    });

    it("normalizes a 3-digit shorthand and a '#'-less input to canonical #RRGGBB", () => {
      const colorScene = scene({ mappings: [mapping({ placeholderClassification: { value: "color", source: "MANIFEST", evidence: [] } })] });
      const shorthand = applyExecutionPlanEdit([colorScene], { type: "SET_BRAND_COLOR", scenePlanId: "scene-1", mappingId: "mapping-1", colorHex: "abc" }, fixedNow);
      expect(shorthand.ok && shorthand.scenePlans[0]?.mappings[0]?.colorHex).toBe("#AABBCC");
    });

    it("rejects SET_BRAND_COLOR when the target mapping is NOT classified as color - unsupported target type", () => {
      const textScene = scene({ mappings: [mapping({ placeholderClassification: { value: "text", source: "MANIFEST", evidence: [] } })] });
      const result = applyExecutionPlanEdit([textScene], { type: "SET_BRAND_COLOR", scenePlanId: "scene-1", mappingId: "mapping-1", colorHex: "#1A2B3C" }, fixedNow);
      expect(result.ok).toBe(false);
    });

    it("CLEAR_BRAND_COLOR resets colorHex to null", () => {
      const colorScene = scene({
        mappings: [mapping({ placeholderClassification: { value: "color", source: "MANIFEST", evidence: [] }, colorHex: "#1A2B3C" })]
      });
      const result = applyExecutionPlanEdit([colorScene], { type: "CLEAR_BRAND_COLOR", scenePlanId: "scene-1", mappingId: "mapping-1" }, fixedNow);
      expect(result.ok && result.scenePlans[0]?.mappings[0]?.colorHex).toBeNull();
    });
  });

  describe("SET_LAYER_VISIBILITY / CLEAR_LAYER_VISIBILITY", () => {
    it("sets the explicit boolean intent on the exact mapping", () => {
      const result = applyExecutionPlanEdit([scene()], { type: "SET_LAYER_VISIBILITY", scenePlanId: "scene-1", mappingId: "mapping-1", enabled: false }, fixedNow);
      expect(result.ok && result.scenePlans[0]?.mappings[0]?.layerVisible).toBe(false);
    });

    it("rejects when the target mapping has no manifestPlaceholderId - no exact canonical layer identity to target", () => {
      const humanScene = scene({ mappings: [mapping({ manifestPlaceholderId: null })] });
      const result = applyExecutionPlanEdit([humanScene], { type: "SET_LAYER_VISIBILITY", scenePlanId: "scene-1", mappingId: "mapping-1", enabled: true }, fixedNow);
      expect(result.ok).toBe(false);
    });

    it("CLEAR_LAYER_VISIBILITY resets to null (no override, not false)", () => {
      const visScene = scene({ mappings: [mapping({ layerVisible: true })] });
      const result = applyExecutionPlanEdit([visScene], { type: "CLEAR_LAYER_VISIBILITY", scenePlanId: "scene-1", mappingId: "mapping-1" }, fixedNow);
      expect(result.ok && result.scenePlans[0]?.mappings[0]?.layerVisible).toBeNull();
    });
  });

  describe("SET_TIME_REMAP_FREEZE / CLEAR_TIME_REMAP_FREEZE", () => {
    it("sets the explicit approved freeze timestamp", () => {
      const result = applyExecutionPlanEdit(
        [scene()],
        { type: "SET_TIME_REMAP_FREEZE", scenePlanId: "scene-1", mappingId: "mapping-1", freezeAtSeconds: 3.25 },
        fixedNow
      );
      expect(result.ok && result.scenePlans[0]?.mappings[0]?.freezeAtSeconds).toBe(3.25);
    });

    it("rejects when the target mapping has no manifestPlaceholderId", () => {
      const humanScene = scene({ mappings: [mapping({ manifestPlaceholderId: null })] });
      const result = applyExecutionPlanEdit(
        [humanScene],
        { type: "SET_TIME_REMAP_FREEZE", scenePlanId: "scene-1", mappingId: "mapping-1", freezeAtSeconds: 1 },
        fixedNow
      );
      expect(result.ok).toBe(false);
    });

    it("CLEAR_TIME_REMAP_FREEZE resets to null", () => {
      const freezeScene = scene({ mappings: [mapping({ freezeAtSeconds: 3 })] });
      const result = applyExecutionPlanEdit([freezeScene], { type: "CLEAR_TIME_REMAP_FREEZE", scenePlanId: "scene-1", mappingId: "mapping-1" }, fixedNow);
      expect(result.ok && result.scenePlans[0]?.mappings[0]?.freezeAtSeconds).toBeNull();
    });
  });

  describe("SET_LAYER_DURATION / CLEAR_LAYER_DURATION", () => {
    it("sets the explicit approved layer duration, distinct from the scene's own finalDuration", () => {
      const durationScene = scene({ finalDuration: 10 });
      const result = applyExecutionPlanEdit(
        [durationScene],
        { type: "SET_LAYER_DURATION", scenePlanId: "scene-1", mappingId: "mapping-1", layerDurationSeconds: 4 },
        fixedNow
      );
      expect(result.ok && result.scenePlans[0]?.mappings[0]?.layerDurationSeconds).toBe(4);
      // The scene-level finalDuration is never touched by a layer-scoped edit.
      expect(result.ok && result.scenePlans[0]?.finalDuration).toBe(10);
    });

    it("rejects when the target mapping has no manifestPlaceholderId", () => {
      const humanScene = scene({ mappings: [mapping({ manifestPlaceholderId: null })] });
      const result = applyExecutionPlanEdit(
        [humanScene],
        { type: "SET_LAYER_DURATION", scenePlanId: "scene-1", mappingId: "mapping-1", layerDurationSeconds: 4 },
        fixedNow
      );
      expect(result.ok).toBe(false);
    });

    it("CLEAR_LAYER_DURATION resets to null", () => {
      const durationScene = scene({ mappings: [mapping({ layerDurationSeconds: 4 })] });
      const result = applyExecutionPlanEdit([durationScene], { type: "CLEAR_LAYER_DURATION", scenePlanId: "scene-1", mappingId: "mapping-1" }, fixedNow);
      expect(result.ok && result.scenePlans[0]?.mappings[0]?.layerDurationSeconds).toBeNull();
    });
  });
});

describe("applyExecutionPlanEdit - mapping-review -> execution-plan propagation fix (real production bug on test22)", () => {
  it("SET_TEXT on the only mapping resolves the scene - unresolvedReasons empties and approvalState becomes READY_FOR_APPROVAL", () => {
    const undecided = scene({ unresolvedReasons: ["no confident structural classification for any detected placeholder yet"] });
    const result = applyExecutionPlanEdit([undecided], { type: "SET_TEXT", scenePlanId: "scene-1", mappingId: "mapping-1", text: "Real headline" }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenePlans[0]?.unresolvedReasons).toEqual([]);
    expect(result.scenePlans[0]?.approvalState).toBe("READY_FOR_APPROVAL");
  });

  it("MAP_ASSET on the only mapping resolves the scene the same way", () => {
    const undecided = scene({ unresolvedReasons: ["no confident structural classification for any detected placeholder yet"] });
    const result = applyExecutionPlanEdit([undecided], { type: "MAP_ASSET", scenePlanId: "scene-1", mappingId: "mapping-1", selectedAssetId: "asset-1", selectedAssetType: "image" }, fixedNow);
    expect(result.ok && result.scenePlans[0]?.unresolvedReasons).toEqual([]);
    expect(result.ok && result.scenePlans[0]?.approvalState).toBe("READY_FOR_APPROVAL");
  });

  it("CLEAR_TEXT on a scene's only mapping makes it unresolved again - stays in sync in both directions", () => {
    const resolved = scene({ mappings: [mapping({ text: "Was real" })], unresolvedReasons: [], approvalState: "READY_FOR_APPROVAL" });
    const result = applyExecutionPlanEdit([resolved], { type: "CLEAR_TEXT", scenePlanId: "scene-1", mappingId: "mapping-1" }, fixedNow);
    expect(result.ok && result.scenePlans[0]?.unresolvedReasons.length).toBeGreaterThan(0);
    expect(result.ok && result.scenePlans[0]?.approvalState).toBe("UNREVIEWED");
  });

  it("a scene explicitly APPROVED by a human is never silently downgraded back to UNREVIEWED by a later content edit that clears a decision", () => {
    const approvedScene = scene({ mappings: [mapping({ text: "Was real" })], unresolvedReasons: [], approvalState: "APPROVED" });
    const result = applyExecutionPlanEdit([approvedScene], { type: "SET_INSTRUCTIONS", scenePlanId: "scene-1", instructions: "unrelated note" }, fixedNow);
    expect(result.ok && result.scenePlans[0]?.approvalState).toBe("APPROVED");
  });

  it("a scene explicitly REJECTED by a human is never silently upgraded to READY_FOR_APPROVAL just because a mapping now has content", () => {
    const rejectedScene = scene({ approvalState: "REJECTED", notes: "needs rework" });
    const result = applyExecutionPlanEdit([rejectedScene], { type: "SET_TEXT", scenePlanId: "scene-1", mappingId: "mapping-1", text: "Fixed" }, fixedNow);
    expect(result.ok && result.scenePlans[0]?.approvalState).toBe("REJECTED");
  });

  it("duplicate label identity: two mappings sharing the exact same placeholderName in different scenes - an edit targeting one by its real mappingId/scenePlanId never touches the other", () => {
    const sceneA = scene({ id: "scene-A", mappings: [mapping({ id: "mapping-A", placeholderName: "Text 01" })] });
    const sceneB = scene({ id: "scene-B", mappings: [mapping({ id: "mapping-B", placeholderName: "Text 01" })] });
    const result = applyExecutionPlanEdit([sceneA, sceneB], { type: "SET_TEXT", scenePlanId: "scene-A", mappingId: "mapping-A", text: "Scene A's real text" }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenePlans.find((s) => s.id === "scene-A")?.mappings[0]?.text).toBe("Scene A's real text");
    // Scene B, sharing the exact same placeholderName, is completely untouched - never recomputed either, since only the addressed scene is.
    expect(result.scenePlans.find((s) => s.id === "scene-B")?.mappings[0]?.text).toBeNull();
    expect(result.scenePlans.find((s) => s.id === "scene-B")).toEqual(sceneB);
  });

  it("duplicate label identity: two mappings sharing the same placeholderName in the SAME scene - the untouched sibling stays undecided", () => {
    const twoTitles = scene({ mappings: [mapping({ id: "mapping-1", placeholderName: "Title" }), mapping({ id: "mapping-2", placeholderName: "Title" })] });
    const result = applyExecutionPlanEdit([twoTitles], { type: "SET_TEXT", scenePlanId: "scene-1", mappingId: "mapping-1", text: "First title" }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenePlans[0]?.mappings.find((m) => m.id === "mapping-1")?.text).toBe("First title");
    expect(result.scenePlans[0]?.mappings.find((m) => m.id === "mapping-2")?.text).toBeNull();
    // The scene as a whole stays unresolved - mapping-2 still needs its own real decision.
    expect(result.scenePlans[0]?.unresolvedReasons.length).toBeGreaterThan(0);
  });

  // Live QA brand-rule blocker fix (2026-09-08): ADD_MAPPING is the first
  // operation that can create a brand-new PlaceholderMapping row on a
  // scene that has none - every other operation above requires an
  // existing mappingId. These tests cover the human-added-mapping
  // contract this exists to serve: real logo/text branding for a
  // template whose own manifest never classified a placeholder for it.
  describe("ADD_MAPPING", () => {
    const emptyScene = scene({ mappings: [] });

    it("creates a real, human-added logo mapping with a real AE layer target, going through the SAME revision/audit path (updatedAt bump, readiness recompute) as every other operation", () => {
      const result = applyExecutionPlanEdit(
        [emptyScene],
        {
          type: "ADD_MAPPING",
          scenePlanId: "scene-1",
          placeholderName: "App Logo (workshop_logo__.png)",
          placeholderClassification: "logo",
          humanLayerIndex: 3,
          selectedAssetId: "asset-logo-1"
        },
        fixedNow
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const updated = result.scenePlans[0]!;
      expect(updated.mappings).toHaveLength(1);
      const created = updated.mappings[0]!;
      expect(created.manifestPlaceholderId).toBeNull();
      expect(created.mappingSource).toBe("HUMAN");
      expect(created.placeholderClassification).toEqual({ value: "logo", source: "HUMAN", evidence: [] });
      expect(created.selectedAssetType).toBe("logo");
      expect(created.selectedAssetId).toBe("asset-logo-1");
      expect(created.humanLayerIndex).toBe(3);
      expect(created.text).toBeNull();
      // Same audit/revision-recompute path every other edit already goes through.
      expect(updated.updatedAt).toBe(NOW.toISOString());
    });

    it("creates a real, human-added text mapping carrying the EXACT required Hebrew branding string, byte-for-byte, never mangled/reversed", () => {
      const REQUIRED_TEXT = "מבית DYO App";
      const result = applyExecutionPlanEdit(
        [emptyScene],
        {
          type: "ADD_MAPPING",
          scenePlanId: "scene-1",
          placeholderName: "DYO branding text",
          placeholderClassification: "text",
          humanLayerIndex: 4,
          text: REQUIRED_TEXT
        },
        fixedNow
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const created = result.scenePlans[0]!.mappings[0]!;
      expect(created.text).toBe(REQUIRED_TEXT);
      expect(created.text).toBe("מבית DYO App");
      expect(created.selectedAssetId).toBeNull();
      expect(created.selectedAssetType).toBeNull();
    });

    it("fails closed when an asset-type classification has no selectedAssetId - never creates a half-real row", () => {
      const result = applyExecutionPlanEdit(
        [emptyScene],
        { type: "ADD_MAPPING", scenePlanId: "scene-1", placeholderName: "Logo", placeholderClassification: "logo", humanLayerIndex: 3, selectedAssetId: null },
        fixedNow
      );
      expect(result.ok).toBe(false);
    });

    it("fails closed when a text classification has no text - never creates a half-real row", () => {
      const result = applyExecutionPlanEdit(
        [emptyScene],
        { type: "ADD_MAPPING", scenePlanId: "scene-1", placeholderName: "Branding text", placeholderClassification: "text", humanLayerIndex: 4, text: null },
        fixedNow
      );
      expect(result.ok).toBe(false);
    });

    it("fails closed for an unsupported classification (e.g. color) - ADD_MAPPING only supports asset types and text today", () => {
      const result = applyExecutionPlanEdit(
        [emptyScene],
        { type: "ADD_MAPPING", scenePlanId: "scene-1", placeholderName: "Brand color", placeholderClassification: "color", humanLayerIndex: 5 },
        fixedNow
      );
      expect(result.ok).toBe(false);
    });

    it("fails closed on a duplicate humanLayerIndex within the same scene - two mappings can never claim the same real AE layer", () => {
      const sceneWithLogo = scene({
        mappings: [mapping({ id: "mapping-logo", manifestPlaceholderId: null, humanLayerIndex: 3, mappingSource: "HUMAN" })]
      });
      const result = applyExecutionPlanEdit(
        [sceneWithLogo],
        { type: "ADD_MAPPING", scenePlanId: "scene-1", placeholderName: "Another logo", placeholderClassification: "logo", humanLayerIndex: 3, selectedAssetId: "asset-2" },
        fixedNow
      );
      expect(result.ok).toBe(false);
    });

    it("never produces duplicate mapping IDs across repeated ADD_MAPPING calls", () => {
      const first = applyExecutionPlanEdit(
        [emptyScene],
        { type: "ADD_MAPPING", scenePlanId: "scene-1", placeholderName: "Logo", placeholderClassification: "logo", humanLayerIndex: 3, selectedAssetId: "asset-1" },
        fixedNow
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const second = applyExecutionPlanEdit(
        first.scenePlans,
        { type: "ADD_MAPPING", scenePlanId: "scene-1", placeholderName: "Branding text", placeholderClassification: "text", humanLayerIndex: 4, text: "מבית DYO App" },
        fixedNow
      );
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      const ids = second.scenePlans[0]!.mappings.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("a scene with a human-added logo mapping and no other unresolved content reaches READY_FOR_APPROVAL, same as any other resolved scene", () => {
      const result = applyExecutionPlanEdit(
        [scene({ mappings: [] })],
        { type: "ADD_MAPPING", scenePlanId: "scene-1", placeholderName: "Logo", placeholderClassification: "logo", humanLayerIndex: 3, selectedAssetId: "asset-1" },
        fixedNow
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.scenePlans[0]?.approvalState).toBe("READY_FOR_APPROVAL");
    });
  });

  // Live QA brand-rule blocker fix, 2026-09-08 correction: the real logo
  // layer for this project lives 4 compositions below the owning scene
  // (!Render) - a direct humanLayerIndex on !Render itself could never
  // reach it. These tests cover the nested-target design.
  describe("ADD_MAPPING - nested composition target", () => {
    const renderScene = scene({ id: "scene-1", manifestCompositionId: "comp-render", mappings: [] });

    it("creates a real, human-added nested logo mapping matching the exact real confirmed chain - humanLayerIndex stays null, humanNestedTarget carries the real path", () => {
      const result = applyExecutionPlanEdit(
        [renderScene],
        {
          type: "ADD_MAPPING",
          scenePlanId: "scene-1",
          placeholderName: "App Logo (workshop_logo__.png)",
          placeholderClassification: "logo",
          humanNestedTarget: REAL_LOGO_NESTED_TARGET,
          selectedAssetId: "asset-logo-1"
        },
        fixedNow,
        nestedTargetManifest()
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const created = result.scenePlans[0]!.mappings[0]!;
      expect(created.manifestPlaceholderId).toBeNull();
      expect(created.mappingSource).toBe("HUMAN");
      expect(created.humanLayerIndex).toBeNull();
      expect(created.humanNestedTarget).toEqual(REAL_LOGO_NESTED_TARGET);
      // The nested target genuinely reaches the intended real layer - the
      // LAST step is the real App Logo composition, real layer 1.
      const lastStep = created.humanNestedTarget![created.humanNestedTarget!.length - 1]!;
      expect(lastStep).toEqual({ compositionId: "comp-logo", layerIndex: 1 });
    });

    it("fails closed when a nested path's compositionId does not exist in the current manifest at all", () => {
      const result = applyExecutionPlanEdit(
        [renderScene],
        {
          type: "ADD_MAPPING",
          scenePlanId: "scene-1",
          placeholderName: "Broken target",
          placeholderClassification: "logo",
          humanNestedTarget: [{ compositionId: "comp-does-not-exist", layerIndex: 1 }],
          selectedAssetId: "asset-1"
        },
        fixedNow,
        nestedTargetManifest()
      );
      expect(result.ok).toBe(false);
    });

    it("fails closed when a nested path step is NOT a real child of the previous step (a broken/invented link, even if every compositionId individually exists)", () => {
      const brokenPath: NestedTargetStep[] = [
        { compositionId: "comp-scene1", layerIndex: 5 },
        // comp-unrelated is real, but its real parent is comp-render
        // directly, never comp-scene1 - this link is invented, not evidence.
        { compositionId: "comp-unrelated", layerIndex: 2 }
      ];
      const result = applyExecutionPlanEdit(
        [renderScene],
        { type: "ADD_MAPPING", scenePlanId: "scene-1", placeholderName: "Broken chain", placeholderClassification: "logo", humanNestedTarget: brokenPath, selectedAssetId: "asset-1" },
        fixedNow,
        nestedTargetManifest()
      );
      expect(result.ok).toBe(false);
    });

    it("fails closed when a nested target is requested but no manifest was supplied to verify it against", () => {
      const result = applyExecutionPlanEdit(
        [renderScene],
        { type: "ADD_MAPPING", scenePlanId: "scene-1", placeholderName: "Logo", placeholderClassification: "logo", humanNestedTarget: REAL_LOGO_NESTED_TARGET, selectedAssetId: "asset-1" },
        fixedNow
        // currentManifest omitted
      );
      expect(result.ok).toBe(false);
    });

    it("rejects ADD_MAPPING carrying BOTH humanLayerIndex and humanNestedTarget - never both", () => {
      const result = applyExecutionPlanEdit(
        [renderScene],
        {
          type: "ADD_MAPPING",
          scenePlanId: "scene-1",
          placeholderName: "Ambiguous target",
          placeholderClassification: "logo",
          humanLayerIndex: 1,
          humanNestedTarget: REAL_LOGO_NESTED_TARGET,
          selectedAssetId: "asset-1"
        },
        fixedNow,
        nestedTargetManifest()
      );
      expect(result.ok).toBe(false);
    });

    it("no accidental targeting of !Render's own layer 1 - a nested target whose FINAL step happens to be layerIndex 1 is never confused with a direct humanLayerIndex:1 mapping on the owning scene itself", () => {
      const result = applyExecutionPlanEdit(
        [renderScene],
        {
          type: "ADD_MAPPING",
          scenePlanId: "scene-1",
          placeholderName: "App Logo (workshop_logo__.png)",
          placeholderClassification: "logo",
          humanNestedTarget: REAL_LOGO_NESTED_TARGET,
          selectedAssetId: "asset-logo-1"
        },
        fixedNow,
        nestedTargetManifest()
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const created = result.scenePlans[0]!.mappings[0]!;
      // Never set - a nested target must never ALSO populate the
      // same-composition field, which would make it indistinguishable
      // from (and could be silently mistaken for) a direct target on the
      // owning scene's own composition (comp-render / !Render) itself.
      expect(created.humanLayerIndex).toBeNull();
      expect(created.humanNestedTarget).not.toBeNull();
    });

    it("a duplicate nested target (same final compositionId+layerIndex) within the same scene is rejected, just like a duplicate direct target", () => {
      const first = applyExecutionPlanEdit(
        [renderScene],
        { type: "ADD_MAPPING", scenePlanId: "scene-1", placeholderName: "Logo", placeholderClassification: "logo", humanNestedTarget: REAL_LOGO_NESTED_TARGET, selectedAssetId: "asset-1" },
        fixedNow,
        nestedTargetManifest()
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const second = applyExecutionPlanEdit(
        first.scenePlans,
        { type: "ADD_MAPPING", scenePlanId: "scene-1", placeholderName: "Logo again", placeholderClassification: "logo", humanNestedTarget: REAL_LOGO_NESTED_TARGET, selectedAssetId: "asset-2" },
        fixedNow,
        nestedTargetManifest()
      );
      expect(second.ok).toBe(false);
    });
  });
});
