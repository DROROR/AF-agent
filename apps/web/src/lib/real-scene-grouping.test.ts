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

  it("attaches a nested-only composition to whichever of its parentCompositionIds is a real scene, when several are listed", () => {
    const m = manifest([
      composition({
        compositionId: "comp-not-real",
        name: "Also Nested",
        isNestedOnlyReferenced: true
      }),
      composition({ compositionId: "comp-real-parent", name: "Real Parent" }),
      composition({
        compositionId: "comp-deep-nested",
        name: "Deep Nested",
        isNestedOnlyReferenced: true,
        parentCompositionIds: ["comp-not-real", "comp-real-parent"]
      })
    ]);
    const plans = [
      scenePlan({ id: "sp-not-real", manifestCompositionId: "comp-not-real", sourcePosition: 0 }),
      scenePlan({
        id: "sp-real-parent",
        manifestCompositionId: "comp-real-parent",
        sourcePosition: 1
      }),
      scenePlan({ id: "sp-deep", manifestCompositionId: "comp-deep-nested", sourcePosition: 2 })
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
});
