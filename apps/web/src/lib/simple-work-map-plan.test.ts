import { describe, expect, it } from "vitest";
import type { Composition, TemplateManifest, WorkMapEntry } from "@dyo/schemas";
import { computeSimpleAiPlanSummary, filterWorkMapEntriesForSimpleMode, hasAnyEditablePlaceholder, groupLayerPlanEntries, hasClientFacingInstructions, isTopLevelPlanEntry, orderPlanEntriesForSimpleMode, sceneLevelPlanEntries } from "./simple-work-map-plan";

function composition(overrides: Partial<Composition> = {}): Composition {
  return {
    compositionId: "c1",
    aeProjectItemIndex: 1,
    name: "Scene 01",
    widthPx: 1920,
    heightPx: 1080,
    durationSeconds: 4,
    frameRate: 30,
    isNestedOnlyReferenced: false,
    parentCompositionIds: [],
    ...overrides
  };
}

function manifest(overrides: Partial<TemplateManifest> = {}): TemplateManifest {
  return {
    schemaVersion: "1.0",
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "C:\\templates\\tmpl.aep", name: "tmpl.aep", sha256: "sha" },
    afterEffects: { version: null },
    generatedAt: new Date().toISOString(),
    compositions: [composition()],
    scenes: [],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: [],
    ...overrides
  };
}

function entry(overrides: Partial<WorkMapEntry> = {}): WorkMapEntry {
  return {
    id: "wm-1",
    sourceCompositionId: null,
    sourceReference: null,
    desiredAssetId: null,
    desiredText: null,
    assetTimestampSeconds: null,
    desiredDurationSeconds: null,
    instructions: null,
    ...overrides
  };
}

/** CASE A - 51 compositions, 1 candidate/top-level scene, 50 isNestedOnlyReferenced=true. */
function realisticFiftyOneCompositionManifest(): TemplateManifest {
  const topLevel = composition({ compositionId: "main-scene", name: "!Render", isNestedOnlyReferenced: false });
  const nested = Array.from({ length: 50 }, (_, i) =>
    composition({ compositionId: `nested-${i}`, name: `Pre-comp ${i}`, isNestedOnlyReferenced: true, parentCompositionIds: ["main-scene"] })
  );
  return manifest({ compositions: [topLevel, ...nested] });
}

describe("filterWorkMapEntriesForSimpleMode", () => {
  it("CASE A: keeps only the entry tied to the 1 real top-level scene, dropping all 50 nested-only-composition entries", () => {
    const m = realisticFiftyOneCompositionManifest();
    const entries = [
      entry({ id: "e-main", sourceCompositionId: "main-scene" }),
      ...Array.from({ length: 50 }, (_, i) => entry({ id: `e-nested-${i}`, sourceCompositionId: `nested-${i}` }))
    ];

    const result = filterWorkMapEntriesForSimpleMode(entries, m);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("e-main");
  });

  it("never drops an entry with no sourceCompositionId - free-text client intent is never structurally classifiable", () => {
    const m = realisticFiftyOneCompositionManifest();
    const freeText = entry({ id: "e-free", sourceCompositionId: null, sourceReference: "the intro" });

    const result = filterWorkMapEntriesForSimpleMode([freeText], m);

    expect(result).toEqual([freeText]);
  });

  it("keeps an entry tied to a real (non-nested-only) composition untouched", () => {
    const m = manifest({ compositions: [composition({ compositionId: "c1", isNestedOnlyReferenced: false })] });
    const e = entry({ sourceCompositionId: "c1" });

    expect(filterWorkMapEntriesForSimpleMode([e], m)).toEqual([e]);
  });
});

describe("computeSimpleAiPlanSummary", () => {
  it("CASE A: reports 1 main scene and 50 supporting compositions from the manifest's own real facts", () => {
    const summary = computeSimpleAiPlanSummary(realisticFiftyOneCompositionManifest());
    expect(summary.mainSceneCount).toBe(1);
    expect(summary.supportingCompositionCount).toBe(50);
  });

  it("counts unresolved items directly from manifest.unknownItems, never fabricated", () => {
    const m = manifest({ unknownItems: [{ context: "Scene 01 / Layer 3", reason: "unclassified" }] });
    expect(computeSimpleAiPlanSummary(m).unresolvedItemCount).toBe(1);
  });
});

describe("hasAnyEditablePlaceholder", () => {
  it("CASE B: is false when the manifest's candidate scenes have zero editable placeholders", () => {
    const m = manifest({
      scenes: [{ sceneId: "s1", displayName: null, compositionId: "c1", originalOrderIndex: 0, startTimeSeconds: 0, durationSeconds: 4, placeholders: [] }]
    });
    expect(hasAnyEditablePlaceholder(m)).toBe(false);
  });

  it("is true once at least one placeholder is editable", () => {
    const m = manifest({
      scenes: [
        {
          sceneId: "s1",
          displayName: null,
          compositionId: "c1",
          originalOrderIndex: 0,
          startTimeSeconds: 0,
          durationSeconds: 4,
          placeholders: [
            {
              placeholderId: "p1",
              displayLabel: null,
              compositionId: "c1",
              layerName: "Logo",
              layerIndex: 1,
              layerPath: [],
              placeholderType: "logo",
              editable: true,
              sourceType: "AVLayer",
              dimensions: null,
              startTimeSeconds: null,
              durationSeconds: null,
              evidence: { source: "read_directly", reason: "matched logo asset" }
            }
          ]
        }
      ]
    });
    expect(hasAnyEditablePlaceholder(m)).toBe(true);
  });
});

describe("hasClientFacingInstructions", () => {
  it("is false when there is no instructions text", () => {
    expect(hasClientFacingInstructions(entry({ instructions: null }))).toBe(false);
  });

  it("is true once real instruction text exists, independent of every other field", () => {
    expect(hasClientFacingInstructions(entry({ instructions: "Keep the original template content unchanged." }))).toBe(true);
    // The real live-QA shape: instructions present, every content-decision field null.
    expect(
      hasClientFacingInstructions(
        entry({ sourceCompositionId: "nested-1", desiredAssetId: null, desiredText: null, instructions: "No uploaded assets available to map." })
      )
    ).toBe(true);
  });
});

describe("a template whose content lives in nested compositions (real failure 2026-10-02)", () => {
  type Placeholder = TemplateManifest["scenes"][number]["placeholders"][number];

  function placeholder(compositionId: string, layerName: string, editable = true): Placeholder {
    return {
      placeholderId: `${compositionId}-${layerName}`,
      displayLabel: null,
      compositionId,
      layerName,
      layerIndex: 1,
      layerPath: [],
      placeholderType: "text",
      editable,
      sourceType: null,
      dimensions: null,
      startTimeSeconds: 0,
      durationSeconds: 4,
      evidence: { source: "read_directly", reason: "test fixture" }
    };
  }

  /** One master; "part-2" and "part-10" hold editable text; "matte" holds nothing; "locked" holds only a non-editable layer. */
  function singleMasterManifest(): TemplateManifest {
    return manifest({
      compositions: [
        composition({ compositionId: "master", name: "Master", isNestedOnlyReferenced: false }),
        composition({ compositionId: "part-10", name: "Part 10", isNestedOnlyReferenced: true }),
        composition({ compositionId: "matte", name: "Matte", isNestedOnlyReferenced: true }),
        composition({ compositionId: "part-2", name: "Part 2", isNestedOnlyReferenced: true }),
        composition({ compositionId: "locked", name: "Locked", isNestedOnlyReferenced: true })
      ],
      scenes: [
        {
          sceneId: "scene-master",
          displayName: null,
          compositionId: "master",
          originalOrderIndex: 0,
          startTimeSeconds: 0,
          durationSeconds: 4,
          placeholders: [placeholder("part-10", "Headline"), placeholder("part-2", "Headline"), placeholder("locked", "Frame", false)]
        }
      ]
    });
  }

  const entries = [
    entry({ id: "e-10", sourceCompositionId: "part-10" }),
    entry({ id: "e-matte", sourceCompositionId: "matte" }),
    entry({ id: "e-master", sourceCompositionId: "master" }),
    entry({ id: "e-2", sourceCompositionId: "part-2" }),
    entry({ id: "e-locked", sourceCompositionId: "locked" })
  ];

  it("shows a nested composition that directly holds editable content", () => {
    const ids = filterWorkMapEntriesForSimpleMode(entries, singleMasterManifest()).map((e) => e.id);
    expect(ids).toContain("e-2");
    expect(ids).toContain("e-10");
  });

  it("still hides a nested composition with nothing editable in it", () => {
    const ids = filterWorkMapEntriesForSimpleMode(entries, singleMasterManifest()).map((e) => e.id);
    expect(ids).not.toContain("e-matte");
    expect(ids).not.toContain("e-locked");
  });

  it("puts the real scene first, then nested parts in natural name order", () => {
    const m = singleMasterManifest();
    expect(orderPlanEntriesForSimpleMode(filterWorkMapEntriesForSimpleMode(entries, m), m).map((e) => e.id)).toEqual(["e-master", "e-2", "e-10"]);
  });

  it("tells a real scene from a nested part, and treats free-text intent as top-level", () => {
    const m = singleMasterManifest();
    expect(isTopLevelPlanEntry(entry({ sourceCompositionId: "master" }), m)).toBe(true);
    expect(isTopLevelPlanEntry(entry({ sourceCompositionId: "part-2" }), m)).toBe(false);
    expect(isTopLevelPlanEntry(entry({ sourceCompositionId: null }), m)).toBe(true);
  });

  describe("rows that name a layer", () => {
    const layerEntries = [
      entry({ id: "r-10", sourceCompositionId: "part-10", targetPlaceholderId: "part-10-Headline", desiredText: "Ten" }),
      entry({ id: "r-note", sourceCompositionId: "master", instructions: "A note about the whole video" }),
      entry({ id: "r-2", sourceCompositionId: "part-2", targetPlaceholderId: "part-2-Headline", desiredText: "Two" }),
      entry({ id: "r-ghost", sourceCompositionId: "part-2", targetPlaceholderId: "no-such-layer", desiredText: "Lost" })
    ];

    it("groups them by the layer's own composition, in natural name order, with the layer's real name", () => {
      const groups = groupLayerPlanEntries(layerEntries, singleMasterManifest());
      expect(groups.map((group) => group.compositionName)).toEqual(["Part 2", "Part 10"]);
      expect(groups[0]!.rows).toEqual([{ entry: layerEntries[2], layerName: "Headline", kind: "text", currentText: null }]);
    });

    it("never shows a row as reaching a layer that is not in this template", () => {
      const shown = groupLayerPlanEntries(layerEntries, singleMasterManifest()).flatMap((group) => group.rows.map((row) => row.entry.id));
      expect(shown).not.toContain("r-ghost");
    });

    it("leaves every other row as a scene-level row, so nothing is shown twice or dropped", () => {
      expect(sceneLevelPlanEntries(layerEntries, singleMasterManifest()).map((e) => e.id)).toEqual(["r-note", "r-ghost"]);
    });

    it("a plan with no layer rows groups to nothing - an older plan is shown exactly as before", () => {
      expect(groupLayerPlanEntries(entries, singleMasterManifest())).toEqual([]);
      expect(sceneLevelPlanEntries(entries, singleMasterManifest())).toEqual(entries);
    });
  });
});
