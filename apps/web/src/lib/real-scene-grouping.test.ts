import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type ScenePlanEntry, type TemplateManifest } from "@dyo/schemas";
import { groupIntoRealScenes } from "./real-scene-grouping";

const NOW = "2026-08-31T00:00:00.000Z";

function composition(
  overrides: Partial<TemplateManifest["compositions"][number]> = {}
): TemplateManifest["compositions"][number] {
  return {
    compositionId: "comp-real",
    aeProjectItemIndex: 1,
    name: "Scene",
    widthPx: 1920,
    heightPx: 1080,
    durationSeconds: 5,
    frameRate: 30,
    isNestedOnlyReferenced: false,
    parentCompositionIds: [],
    ...overrides
  };
}

function manifest(compositions: TemplateManifest["compositions"]): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW,
    compositions,
    scenes: [],
    preflight: {
      requiredFonts: [],
      footageReferenced: [],
      missingFootage: [],
      pluginReferences: []
    },
    unknownItems: []
  };
}

function scenePlan(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: overrides.manifestCompositionId ?? "scene-real",
    manifestCompositionId: "comp-real",
    compositionName: "Scene",
    use: true,
    sourcePosition: 0,
    finalOrder: null,
    finalDuration: null,
    approvalState: "UNREVIEWED",
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

describe("groupIntoRealScenes", () => {
  it("shows one real scene per non-nested-only composition, in source order", () => {
    const m = manifest([
      composition({ compositionId: "comp-b", name: "Scene B" }),
      composition({ compositionId: "comp-a", name: "Scene A" })
    ]);
    const plans = [
      scenePlan({
        id: "sp-b",
        manifestCompositionId: "comp-b",
        compositionName: "Scene B",
        sourcePosition: 1
      }),
      scenePlan({
        id: "sp-a",
        manifestCompositionId: "comp-a",
        compositionName: "Scene A",
        sourcePosition: 0
      })
    ];
    const result = groupIntoRealScenes(m, plans);
    expect(result.map((s) => s.manifestCompositionId)).toEqual(["comp-a", "comp-b"]);
  });

  it("never shows a nested-only composition as its own real-scene card - it is attached under its real parent's nested[] instead", () => {
    const m = manifest([
      composition({ compositionId: "comp-parent", name: "App Features" }),
      composition({
        compositionId: "comp-phone-frame",
        name: "Phone Frame",
        isNestedOnlyReferenced: true,
        parentCompositionIds: ["comp-parent"]
      })
    ]);
    const plans = [
      scenePlan({
        id: "sp-parent",
        manifestCompositionId: "comp-parent",
        compositionName: "App Features",
        sourcePosition: 0
      }),
      scenePlan({
        id: "sp-nested",
        manifestCompositionId: "comp-phone-frame",
        compositionName: "Phone Frame",
        sourcePosition: 1
      })
    ];
    const result = groupIntoRealScenes(m, plans);
    expect(result).toHaveLength(1);
    expect(result[0]?.manifestCompositionId).toBe("comp-parent");
    expect(result[0]?.nested).toHaveLength(1);
    expect(result[0]?.nested[0]?.manifestCompositionId).toBe("comp-phone-frame");
  });

  it("attaches a composition to whichever of its several parentCompositionIds is directly a real scene, preferring it over one that is itself only nested content", () => {
    const m = manifest([
      composition({ compositionId: "comp-unrelated-wrapper", name: "Some Other Wrapper" }),
      composition({
        compositionId: "comp-not-real",
        name: "Also Nested",
        parentCompositionIds: ["comp-unrelated-wrapper"]
      }),
      composition({ compositionId: "comp-real-parent", name: "Real Parent" }),
      composition({
        compositionId: "comp-deep-nested",
        name: "Deep Nested",
        parentCompositionIds: ["comp-not-real", "comp-real-parent"]
      })
    ]);
    const plans = [
      scenePlan({ id: "sp-wrapper", manifestCompositionId: "comp-unrelated-wrapper", sourcePosition: 0 }),
      scenePlan({ id: "sp-not-real", manifestCompositionId: "comp-not-real", sourcePosition: 1 }),
      scenePlan({
        id: "sp-real-parent",
        manifestCompositionId: "comp-real-parent",
        sourcePosition: 2
      }),
      scenePlan({ id: "sp-deep", manifestCompositionId: "comp-deep-nested", sourcePosition: 3 })
    ];
    const result = groupIntoRealScenes(m, plans);
    const realParent = result.find((s) => s.manifestCompositionId === "comp-real-parent");
    expect(realParent?.nested.map((n) => n.manifestCompositionId)).toEqual(["comp-deep-nested"]);
  });

  it("never silently drops a nested-only composition with no real-scene ancestor anywhere in the plan - it still surfaces as its own real scene", () => {
    const m = manifest([
      composition({
        compositionId: "comp-orphan",
        name: "Orphan",
        isNestedOnlyReferenced: true,
        parentCompositionIds: ["comp-does-not-exist"]
      })
    ]);
    const plans = [
      scenePlan({
        id: "sp-orphan",
        manifestCompositionId: "comp-orphan",
        compositionName: "Orphan",
        sourcePosition: 0
      })
    ];
    const result = groupIntoRealScenes(m, plans);
    expect(result).toHaveLength(1);
    expect(result[0]?.manifestCompositionId).toBe("comp-orphan");
  });

  it("a composition missing from manifest.compositions entirely (should not happen for a well-formed plan) is still shown as a real scene, never crashes", () => {
    const m = manifest([]);
    const plans = [scenePlan({ id: "sp-x", manifestCompositionId: "comp-x", sourcePosition: 0 })];
    const result = groupIntoRealScenes(m, plans);
    expect(result).toHaveLength(1);
  });

  describe("a sequence-master root (>=2 direct children) - the test22 'Main Comp -> Scene_01..06' shape, LIVE UX ACCEPTANCE FAILED follow-up", () => {
    function mainCompWithScenes(sceneCount: number) {
      const sceneIds = Array.from({ length: sceneCount }, (_, i) => `comp-scene-${i}`);
      return {
        compositions: [
          composition({ compositionId: "comp-main", name: "Main Comp" }),
          ...sceneIds.map((id, i) => composition({ compositionId: id, name: `Scene_0${i + 1}`, parentCompositionIds: ["comp-main"] }))
        ],
        sceneIds
      };
    }

    it("shows each of a master's >=2 direct children as its own real scene, never the master itself, when the master has no content of its own", () => {
      const { compositions, sceneIds } = mainCompWithScenes(3);
      const m = manifest(compositions);
      const plans = [
        scenePlan({ id: "sp-main", manifestCompositionId: "comp-main", sourcePosition: 0, mappings: [] }),
        ...sceneIds.map((id, i) => scenePlan({ id: `sp-${id}`, manifestCompositionId: id, compositionName: `Scene_0${i + 1}`, sourcePosition: i + 1 }))
      ];
      const result = groupIntoRealScenes(m, plans);
      expect(result.map((s) => s.manifestCompositionId)).toEqual(sceneIds);
      expect(result.find((s) => s.manifestCompositionId === "comp-main")).toBeUndefined();
    });

    it("also shows the master itself as a real scene when it carries real content of its own (never silently drops it)", () => {
      const { compositions, sceneIds } = mainCompWithScenes(2);
      const m = manifest(compositions);
      const mainMapping = { id: "mapping-logo", manifestPlaceholderId: "ph-logo", placeholderName: "Persistent Logo", placeholderClassification: { value: "logo", source: "MANIFEST", evidence: [] }, selectedAssetId: null, selectedAssetType: null, text: null, assetTimestamp: null, colorHex: null, layerVisible: null, freezeAtSeconds: null, layerDurationSeconds: null, mappingSource: "MANIFEST", confidence: null, createdAt: NOW, updatedAt: NOW } as ScenePlanEntry["mappings"][number];
      const plans = [
        scenePlan({ id: "sp-main", manifestCompositionId: "comp-main", sourcePosition: 0, mappings: [mainMapping] }),
        ...sceneIds.map((id, i) => scenePlan({ id: `sp-${id}`, manifestCompositionId: id, compositionName: `Scene_0${i + 1}`, sourcePosition: i + 1 }))
      ];
      const result = groupIntoRealScenes(m, plans);
      expect(result.map((s) => s.manifestCompositionId).sort()).toEqual(["comp-main", ...sceneIds].sort());
    });

    it("groups a placeholder nested two levels deep (Placeholder inside a Scene inside Main Comp) under the correct real Scene, not under Main Comp", () => {
      const { compositions, sceneIds } = mainCompWithScenes(2);
      const m = manifest([
        ...compositions,
        composition({ compositionId: "comp-placeholder-1", name: "Placeholder_1", parentCompositionIds: [sceneIds[0]!] })
      ]);
      const plans = [
        scenePlan({ id: "sp-main", manifestCompositionId: "comp-main", sourcePosition: 0, mappings: [] }),
        ...sceneIds.map((id, i) => scenePlan({ id: `sp-${id}`, manifestCompositionId: id, compositionName: `Scene_0${i + 1}`, sourcePosition: i + 1 })),
        scenePlan({ id: "sp-placeholder-1", manifestCompositionId: "comp-placeholder-1", compositionName: "Placeholder_1", sourcePosition: 3 })
      ];
      const result = groupIntoRealScenes(m, plans);
      // Real scenes are exactly the two Scene_XX comps - never Main Comp, never Placeholder_1 on its own.
      expect(result.map((s) => s.manifestCompositionId)).toEqual(sceneIds);
      const sceneOne = result.find((s) => s.manifestCompositionId === sceneIds[0]);
      expect(sceneOne?.nested.map((n) => n.manifestCompositionId)).toEqual(["comp-placeholder-1"]);
    });

    it("stays a single real scene per composition (degrades to the pre-graph behavior) when a manifest has no detected nesting at all - e.g. captured before this capability existed", () => {
      // Every composition here is its own childless root - parentCompositionIds
      // is empty everywhere, exactly what an old/not-yet-re-inspected
      // manifest looks like.
      const m = manifest([
        composition({ compositionId: "comp-logo", name: "Logo" }),
        composition({ compositionId: "comp-placeholder-1", name: "Placeholder_1" }),
        composition({ compositionId: "comp-scene-1", name: "Scene_01" })
      ]);
      const plans = [
        scenePlan({ id: "sp-logo", manifestCompositionId: "comp-logo", sourcePosition: 0 }),
        scenePlan({ id: "sp-placeholder-1", manifestCompositionId: "comp-placeholder-1", sourcePosition: 1 }),
        scenePlan({ id: "sp-scene-1", manifestCompositionId: "comp-scene-1", sourcePosition: 2 })
      ];
      const result = groupIntoRealScenes(m, plans);
      expect(result).toHaveLength(3);
    });
  });
});
