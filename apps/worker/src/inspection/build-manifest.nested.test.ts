import { describe, expect, it } from "vitest";
import { templateManifestSchema, type NestedTargetStep, type Placeholder, type TemplateManifest } from "@dyo/schemas";
import { buildTemplateManifest, computeInspectionSummary, MAX_NESTED_COMPOSITION_DEPTH } from "./build-manifest.js";
import type { CompositionFact, FootageFact, LayerFact, PrecompChildFact, ProjectFacts } from "./project-facts.js";

/**
 * Regression fixtures for nested-composition placeholder discovery.
 *
 * REAL 2026-09-12 RESULT that motivated this (job 5441c555, the plugin-free
 * Mixkit "smartphone promo" template): 21 compositions and ~96 layers
 * produced ONE placeholder - a CONTROLS solid - because Main_Comp's other
 * five layers are precomp references and nothing below them was examined.
 *
 * The COMPOSITION GRAPH below is copied from that real manifest's own
 * parentCompositionIds (real ids and names): Main_Comp -> Smartphone_0X ->
 * Smartphone_0X_PreComp -> Placeholder_0X -> _Place_Image_Above_Mobile,
 * including two real structural quirks the traversal must survive:
 *  - a DIAMOND: Placeholder_01 is referenced by BOTH Smartphone_01 and
 *    Smartphone_01_PreComp;
 *  - a SHARED precomp: _Place_Image_Above_Mobile has five real parents.
 * Individual layer names/kinds/indices inside those compositions were never
 * persisted by that job, so they are representative here - the expected
 * counts below derive from THIS fixture, never a claim about the real
 * template's placeholder count.
 */

const ID = {
  main: "comp-2144961805",
  s01: "comp-2144954688",
  s01pre: "comp-2144955123",
  s02: "comp-2144954612",
  ph01: "comp-2144951525",
  ph01_1: "comp-749",
  ph02: "comp-2144961857",
  mobile: "comp-252",
  appScreen01: "comp-3270"
} as const;

const still: FootageFact = { hasVideo: false, hasAudio: false, isStill: true, isMissing: false, widthPx: 1242, heightPx: 2648 };
const video: FootageFact = { hasVideo: true, hasAudio: true, isStill: false, isMissing: false, widthPx: 1920, heightPx: 1080 };

function layer(overrides: Partial<LayerFact> & Pick<LayerFact, "name" | "index">): LayerFact {
  return {
    layerKind: "Unknown",
    footage: null,
    solidFill: null,
    enabled: true,
    layerPath: [],
    startTimeSeconds: 0,
    durationSeconds: 5,
    ...overrides
  };
}

const text = (index: number, name: string, extra: Partial<LayerFact> = {}) => layer({ index, name, layerKind: "TextLayer", ...extra });
const image = (index: number, name: string, extra: Partial<LayerFact> = {}) =>
  layer({ index, name, layerKind: "AVLayer", footage: still, ...extra });
const precomp = (layerIndex: number, layerName: string, sourceCompositionId: string, enabled: boolean | null = true): PrecompChildFact => ({
  layerIndex,
  layerName,
  sourceCompositionId,
  enabled
});

function composition(
  overrides: Partial<CompositionFact> & Pick<CompositionFact, "compositionId" | "name">
): CompositionFact {
  return {
    aeProjectItemIndex: 1,
    widthPx: 1920,
    heightPx: 1080,
    durationSeconds: 21.44,
    frameRate: 25,
    isNestedOnlyReferenced: true,
    parentCompositionIds: [],
    layers: [],
    precompChildren: [],
    ...overrides
  };
}

function facts(compositions: CompositionFact[]): ProjectFacts {
  return {
    templateId: "mixkit-smartphone-promo-596",
    templateName: "App Promo",
    aeVersion: "26.3x87",
    sourceProjectPath: "C:\\DYO-Agent\\copies\\mixkit-smartphone-promo-596\\596\\App_Promo.aep",
    sourceProjectName: "App_Promo.aep",
    projectSha256: "4172ee082c1ce15f9e180d17e128434d4b54a40b3596402e1a30e496415deafd",
    compositions,
    requiredFonts: ["Arial-BoldMT", "HelveticaNeue", "HelveticaNeue-Bold"],
    footageReferenced: [],
    missingFootage: [],
    pluginReferences: []
  };
}

const fixedNow = () => new Date("2026-09-13T00:00:00.000Z");

/** The Mixkit-shaped graph. See this file's doc comment for what is real. */
function mixkitShape(): CompositionFact[] {
  return [
    composition({
      compositionId: ID.main,
      name: "Main_Comp",
      aeProjectItemIndex: 1,
      isNestedOnlyReferenced: false,
      // The one real surviving top-level layer.
      layers: [layer({ index: 1, name: "CONTROLS", layerKind: "AVLayer", solidFill: { isUniformSolidFill: true } })],
      precompChildren: [precomp(3, "Smartphone_02", ID.s02), precomp(2, "Smartphone_01", ID.s01)]
    }),
    composition({
      compositionId: ID.s01,
      name: "Smartphone_01",
      aeProjectItemIndex: 38,
      parentCompositionIds: [ID.main],
      layers: [layer({ index: 3, name: "Camera 1", layerKind: "CameraLayer" }), text(4, "Tagline")],
      precompChildren: [precomp(1, "Smartphone_01_PreComp", ID.s01pre), precomp(2, "Placeholder_01", ID.ph01)]
    }),
    composition({
      compositionId: ID.s01pre,
      name: "Smartphone_01_PreComp",
      aeProjectItemIndex: 32,
      parentCompositionIds: [ID.s01],
      layers: [
        layer({ index: 1, name: "Phone Bezel", layerKind: "ShapeLayer" }),
        layer({ index: 4, name: "BG", layerKind: "AVLayer", solidFill: { isUniformSolidFill: true } }),
        text(5, "Headline")
      ],
      precompChildren: [precomp(2, "Placeholder_01", ID.ph01), precomp(3, "Placeholder_01-1", ID.ph01_1)]
    }),
    composition({
      compositionId: ID.ph01,
      name: "Placeholder_01",
      aeProjectItemIndex: 3,
      parentCompositionIds: [ID.s01pre, ID.s01],
      precompChildren: [precomp(1, "_Place_Image_Above_Mobile", ID.mobile)]
    }),
    composition({
      compositionId: ID.ph01_1,
      name: "Placeholder_01-1",
      aeProjectItemIndex: 4,
      parentCompositionIds: [ID.s01pre],
      precompChildren: [precomp(1, "_Place Image Above_App Screen 01", ID.appScreen01)]
    }),
    composition({
      compositionId: ID.appScreen01,
      name: "_Place Image Above_App Screen 01",
      aeProjectItemIndex: 29,
      parentCompositionIds: [ID.ph01_1],
      layers: [text(1, "App Title"), image(2, "screen01.jpg"), image(3, "_Place Image Above", { enabled: false })]
    }),
    composition({
      compositionId: ID.mobile,
      name: "_Place_Image_Above_Mobile",
      aeProjectItemIndex: 31,
      parentCompositionIds: [ID.ph01, ID.ph02],
      layers: [image(1, "App_Screen.png"), image(2, "_Place Image Above", { enabled: false })]
    }),
    composition({
      compositionId: ID.s02,
      name: "Smartphone_02",
      aeProjectItemIndex: 39,
      parentCompositionIds: [ID.main],
      precompChildren: [precomp(1, "Placeholder_02", ID.ph02)]
    }),
    composition({
      compositionId: ID.ph02,
      name: "Placeholder_02",
      aeProjectItemIndex: 6,
      parentCompositionIds: [ID.s02],
      layers: [layer({ index: 2, name: "promo.mp4", layerKind: "AVLayer", footage: video })],
      precompChildren: [precomp(1, "_Place_Image_Above_Mobile", ID.mobile)]
    })
  ];
}

function scenePlaceholders(manifest: TemplateManifest): Placeholder[] {
  expect(manifest.scenes).toHaveLength(1);
  return manifest.scenes[0]!.placeholders;
}

const nestedOnly = (placeholders: Placeholder[]) => placeholders.filter((p) => p.nestedTarget);

/**
 * Mirrors verifyNestedTargetPath (apps/api) exactly, so a chain this module
 * emits is proven to be one the API will accept: the first step must be a
 * real child of the scene, and each later step a real child of the previous.
 */
function assertChainVerifies(manifest: TemplateManifest, sceneCompositionId: string, chain: readonly NestedTargetStep[]): void {
  const byId = new Map(manifest.compositions.map((c) => [c.compositionId, c]));
  let expectedParent = sceneCompositionId;
  for (const step of chain) {
    const comp = byId.get(step.compositionId);
    expect(comp, `step composition ${step.compositionId} exists`).toBeDefined();
    expect(comp!.parentCompositionIds, `${step.compositionId} is a real child of ${expectedParent}`).toContain(expectedParent);
    expectedParent = step.compositionId;
  }
}

describe("buildTemplateManifest - nested composition traversal (Mixkit-shaped regression)", () => {
  it("surfaces the editable layers inside precomps, in deterministic AE stacking order", () => {
    const placeholders = scenePlaceholders(buildTemplateManifest(facts(mixkitShape()), fixedNow));

    expect(placeholders.map((p) => `${p.layerName} (${p.placeholderType})`)).toEqual([
      "CONTROLS (color)",
      "App_Screen.png (image)",
      "App Title (text)",
      "screen01.jpg (image)",
      "Headline (text)",
      "Tagline (text)",
      "promo.mp4 (video)"
    ]);
  });

  it("no longer presents CONTROLS as the only editable placeholder", () => {
    const manifest = buildTemplateManifest(facts(mixkitShape()), fixedNow);
    const editable = scenePlaceholders(manifest).filter((p) => p.editable);

    expect(editable.map((p) => p.layerName)).toContain("CONTROLS");
    expect(editable.length).toBeGreaterThan(1);
    expect(computeInspectionSummary(manifest).editablePlaceholderCount).toBe(editable.length);
  });

  it("keeps the scene's own top-level placeholder unchanged: same ID formula, no chain, first in the list", () => {
    const placeholders = scenePlaceholders(buildTemplateManifest(facts(mixkitShape()), fixedNow));
    const controls = placeholders[0]!;

    expect(controls.layerName).toBe("CONTROLS");
    expect(controls.compositionId).toBe(ID.main);
    expect(controls.layerPath).toEqual([]);
    expect(controls.nestedTarget).toBeNull();
  });

  it("gives each nested placeholder its CONTAINING composition and the full composition-name path", () => {
    const byName = new Map(scenePlaceholders(buildTemplateManifest(facts(mixkitShape()), fixedNow)).map((p) => [p.layerName, p]));

    expect(byName.get("App Title")).toMatchObject({
      compositionId: ID.appScreen01,
      layerIndex: 1,
      layerPath: ["Smartphone_01", "Smartphone_01_PreComp", "Placeholder_01-1", "_Place Image Above_App Screen 01"]
    });
    expect(byName.get("Headline")).toMatchObject({
      compositionId: ID.s01pre,
      layerIndex: 5,
      layerPath: ["Smartphone_01", "Smartphone_01_PreComp"]
    });
    expect(byName.get("Tagline")).toMatchObject({ compositionId: ID.s01, layerIndex: 4, layerPath: ["Smartphone_01"] });
  });

  // The executable half. Every non-last step's layerIndex is the precomp
  // layer INSIDE that step's composition that leads to the next step; the
  // last step is the layer itself; the scene is never a step. A wrong chain
  // here edits the wrong layer in production.
  it("emits nestedTarget chains with the exact semantics dispatch executes", () => {
    const byName = new Map(scenePlaceholders(buildTemplateManifest(facts(mixkitShape()), fixedNow)).map((p) => [p.layerName, p]));

    expect(byName.get("App Title")!.nestedTarget).toEqual([
      { compositionId: ID.s01, layerIndex: 1 },
      { compositionId: ID.s01pre, layerIndex: 3 },
      { compositionId: ID.ph01_1, layerIndex: 1 },
      { compositionId: ID.appScreen01, layerIndex: 1 }
    ]);
    expect(byName.get("Tagline")!.nestedTarget).toEqual([{ compositionId: ID.s01, layerIndex: 4 }]);
    expect(byName.get("promo.mp4")!.nestedTarget).toEqual([
      { compositionId: ID.s02, layerIndex: 1 },
      { compositionId: ID.ph02, layerIndex: 2 }
    ]);
  });

  it("ends every chain at the placeholder's own (compositionId, layerIndex), and every chain verifies against the composition graph", () => {
    const manifest = buildTemplateManifest(facts(mixkitShape()), fixedNow);
    for (const p of nestedOnly(scenePlaceholders(manifest))) {
      const last = p.nestedTarget![p.nestedTarget!.length - 1]!;
      expect(last).toEqual({ compositionId: p.compositionId, layerIndex: p.layerIndex });
      assertChainVerifies(manifest, ID.main, p.nestedTarget!);
    }
  });

  it("emits ONE placeholder for a layer inside a precomp shared by several parents - never phantom copies", () => {
    const placeholders = scenePlaceholders(buildTemplateManifest(facts(mixkitShape()), fixedNow));
    const appScreen = placeholders.filter((p) => p.compositionId === ID.mobile && p.layerIndex === 1);

    expect(appScreen).toHaveLength(1);
    // First path in traversal order wins: Smartphone_01 (layer 2 in Main)
    // precedes Smartphone_02 (layer 3), and inside it the PreComp (layer 1)
    // precedes the direct diamond reference (layer 2).
    expect(appScreen[0]!.layerPath).toEqual(["Smartphone_01", "Smartphone_01_PreComp", "Placeholder_01", "_Place_Image_Above_Mobile"]);
  });

  it("walks through the real diamond (Placeholder_01 under two parents) without duplicating anything", () => {
    const placeholders = scenePlaceholders(buildTemplateManifest(facts(mixkitShape()), fixedNow));
    const identities = placeholders.map((p) => `${p.compositionId}:${p.layerIndex}`);
    expect(new Set(identities).size).toBe(identities.length);
    expect(new Set(placeholders.map((p) => p.placeholderId)).size).toBe(placeholders.length);
  });

  it("excludes nested structural layers by AE fact - disabled guides, shapes, cameras, solids - without reporting them as unknown", () => {
    const manifest = buildTemplateManifest(facts(mixkitShape()), fixedNow);
    const names = scenePlaceholders(manifest).map((p) => p.layerName);

    for (const structural of ["_Place Image Above", "Phone Bezel", "Camera 1", "BG"]) {
      expect(names).not.toContain(structural);
    }
    expect(manifest.unknownItems).toEqual([]);
  });

  it("produces identical output on every run, and regardless of the ORDER precomp edges were supplied in", () => {
    const first = buildTemplateManifest(facts(mixkitShape()), fixedNow);
    const shuffled = mixkitShape().map((c) => ({ ...c, precompChildren: [...c.precompChildren].reverse() })).reverse();
    const second = buildTemplateManifest(facts(shuffled), fixedNow);

    expect(scenePlaceholders(second)).toEqual(scenePlaceholders(first));
  });

  // CLAUDE.md: stable placeholder IDs must be independent of human labels.
  // Composition and layer NAMES are human labels, so they never feed an ID.
  it("keeps nested placeholder IDs stable across a composition rename, while layerPath reflects the new name", () => {
    const before = buildTemplateManifest(facts(mixkitShape()), fixedNow);
    const renamed = mixkitShape().map((c) => (c.compositionId === ID.s01pre ? { ...c, name: "Phone Rig (renamed)" } : c));
    const after = buildTemplateManifest(facts(renamed), fixedNow);

    const headlineBefore = scenePlaceholders(before).find((p) => p.layerName === "Headline")!;
    const headlineAfter = scenePlaceholders(after).find((p) => p.layerName === "Headline")!;
    expect(headlineAfter.placeholderId).toBe(headlineBefore.placeholderId);
    expect(headlineAfter.layerPath).toEqual(["Smartphone_01", "Phone Rig (renamed)"]);
  });

  it("round-trips through the real manifest schema WITHOUT stripping nestedTarget", () => {
    const manifest = buildTemplateManifest(facts(mixkitShape()), fixedNow);
    const parsed = templateManifestSchema.parse(JSON.parse(JSON.stringify(manifest)));

    expect(nestedOnly(parsed.scenes[0]!.placeholders).length).toBe(nestedOnly(scenePlaceholders(manifest)).length);
    expect(parsed.scenes[0]!.placeholders.find((p) => p.layerName === "Tagline")!.nestedTarget).toEqual([
      { compositionId: ID.s01, layerIndex: 4 }
    ]);
  });

  it("still parses a manifest persisted BEFORE nestedTarget existed", () => {
    const legacy = JSON.parse(JSON.stringify(buildTemplateManifest(facts(mixkitShape()), fixedNow)));
    for (const p of legacy.scenes[0].placeholders) {
      delete p.nestedTarget;
    }
    expect(() => templateManifestSchema.parse(legacy)).not.toThrow();
  });
});

describe("buildTemplateManifest - nested traversal honesty and safety bounds", () => {
  const scene = (precompChildren: PrecompChildFact[]) =>
    composition({ compositionId: "comp-root", name: "Root", isNestedOnlyReferenced: false, precompChildren });

  it("reports a nested layer it cannot confidently classify as an unknownItem - never hides it, never guesses", () => {
    const manifest = buildTemplateManifest(
      facts([
        scene([precomp(1, "Inner", "comp-inner")]),
        composition({
          compositionId: "comp-inner",
          name: "Inner",
          parentCompositionIds: ["comp-root"],
          layers: [layer({ index: 1, name: "Mystery", layerKind: "Unknown" })]
        })
      ]),
      fixedNow
    );

    expect(manifest.scenes[0]!.placeholders).toEqual([]);
    expect(manifest.unknownItems).toHaveLength(1);
    expect(manifest.unknownItems[0]!.context).toBe("Root / Inner / Mystery");
  });

  it("reports a nested layer whose footage is MISSING as an unknownItem, not as an editable placeholder", () => {
    const manifest = buildTemplateManifest(
      facts([
        scene([precomp(1, "Inner", "comp-inner")]),
        composition({
          compositionId: "comp-inner",
          name: "Inner",
          parentCompositionIds: ["comp-root"],
          layers: [image(1, "gone.png", { footage: { ...still, isMissing: true } })]
        })
      ]),
      fixedNow
    );

    expect(manifest.scenes[0]!.placeholders).toEqual([]);
    expect(manifest.unknownItems[0]!.reason).toMatch(/missing/);
  });

  it("terminates on a CYCLIC precomp graph and reports it, instead of recursing forever", () => {
    const manifest = buildTemplateManifest(
      facts([
        scene([precomp(1, "A", "comp-a")]),
        composition({
          compositionId: "comp-a",
          name: "A",
          parentCompositionIds: ["comp-root", "comp-b"],
          layers: [text(2, "In A")],
          precompChildren: [precomp(1, "B", "comp-b")]
        }),
        composition({
          compositionId: "comp-b",
          name: "B",
          parentCompositionIds: ["comp-a"],
          layers: [text(2, "In B")],
          precompChildren: [precomp(1, "back to A", "comp-a")]
        })
      ]),
      fixedNow
    );

    expect(manifest.scenes[0]!.placeholders.map((p) => p.layerName)).toEqual(["In B", "In A"]);
    expect(manifest.unknownItems.some((u) => /cyclic/.test(u.reason))).toBe(true);
  });

  it(`stops at ${MAX_NESTED_COMPOSITION_DEPTH} levels and reports what it did not inspect`, () => {
    const depth = MAX_NESTED_COMPOSITION_DEPTH + 5;
    const chain: CompositionFact[] = [scene([precomp(1, "L1", "comp-1")])];
    for (let level = 1; level <= depth; level += 1) {
      chain.push(
        composition({
          compositionId: `comp-${level}`,
          name: `L${level}`,
          parentCompositionIds: [level === 1 ? "comp-root" : `comp-${level - 1}`],
          layers: [text(2, `Text L${level}`)],
          precompChildren: level < depth ? [precomp(1, `L${level + 1}`, `comp-${level + 1}`)] : []
        })
      );
    }

    const manifest = buildTemplateManifest(facts(chain), fixedNow);

    expect(manifest.scenes[0]!.placeholders).toHaveLength(MAX_NESTED_COMPOSITION_DEPTH);
    expect(manifest.unknownItems.some((u) => /deeper than/.test(u.reason))).toBe(true);
  });

  it("reports a precomp that points at a composition which was never inspected", () => {
    const manifest = buildTemplateManifest(facts([scene([precomp(1, "Ghost", "comp-not-inspected")])]), fixedNow);

    expect(manifest.scenes[0]!.placeholders).toEqual([]);
    expect(manifest.unknownItems).toEqual([
      {
        context: "Root / Ghost",
        reason: expect.stringContaining("was not inspected")
      }
    ]);
  });

  // Code review findings (2026-09-13). Giving a shared layer only to the FIRST
  // scene starved later scenes (scene selection is a human decision). Each
  // scene now lists the layer; a CONFLICTING cross-scene write is refused at
  // dispatch instead (see resolve-execute-frame-dispatch tests).
  it("surfaces a layer inside a precomp shared by two scenes in EACH scene, with distinct placeholder IDs", () => {
    const shared = composition({
      compositionId: "comp-shared",
      name: "Shared",
      parentCompositionIds: ["comp-s1", "comp-s2"],
      layers: [text(1, "Logo Text")]
    });
    const manifest = buildTemplateManifest(
      facts([
        composition({ compositionId: "comp-s1", name: "Scene 1", isNestedOnlyReferenced: false, precompChildren: [precomp(1, "Shared", "comp-shared")] }),
        composition({ compositionId: "comp-s2", name: "Scene 2", isNestedOnlyReferenced: false, precompChildren: [precomp(1, "Shared", "comp-shared")] }),
        shared
      ]),
      fixedNow
    );

    const perScene = manifest.scenes.map((sc) => sc.placeholders.filter((p) => p.compositionId === "comp-shared" && p.layerIndex === 1));
    expect(perScene.map((list) => list.length)).toEqual([1, 1]);
    expect(perScene[0]![0]!.placeholderId).not.toBe(perScene[1]![0]!.placeholderId);
    expect(manifest.unknownItems).toEqual([]);
  });

  it("keeps each scene's placeholder ID for a shared layer independent of scene ORDER", () => {
    const shared = composition({ compositionId: "comp-shared", name: "Shared", parentCompositionIds: ["comp-s1", "comp-s2"], layers: [text(1, "Logo Text")] });
    const s1 = composition({ compositionId: "comp-s1", name: "Scene 1", isNestedOnlyReferenced: false, precompChildren: [precomp(1, "Shared", "comp-shared")] });
    const s2 = composition({ compositionId: "comp-s2", name: "Scene 2", isNestedOnlyReferenced: false, precompChildren: [precomp(1, "Shared", "comp-shared")] });

    const idIn = (m: TemplateManifest, sceneId: string) =>
      m.scenes.find((sc) => sc.compositionId === sceneId)!.placeholders.find((p) => p.compositionId === "comp-shared")!.placeholderId;
    const forward = buildTemplateManifest(facts([s1, s2, shared]), fixedNow);
    const reversed = buildTemplateManifest(facts([s2, s1, shared]), fixedNow);
    expect(idIn(forward, "comp-s1")).toBe(idIn(reversed, "comp-s1"));
    expect(idIn(forward, "comp-s2")).toBe(idIn(reversed, "comp-s2"));
  });

  // Code review finding (2026-09-13): a hidden guide precomp must not surface
  // approvable placeholders whose edits change nothing visible.
  it("never descends through a DISABLED precomp-reference layer", () => {
    const manifest = buildTemplateManifest(
      facts([
        scene([precomp(1, "Hidden Guide", "comp-guide", false)]),
        composition({ compositionId: "comp-guide", name: "Guide", parentCompositionIds: ["comp-root"], layers: [text(1, "Guide Text"), image(2, "guide.png")] })
      ]),
      fixedNow
    );

    expect(manifest.scenes[0]!.placeholders).toEqual([]);
    expect(manifest.unknownItems).toEqual([]);
  });

  it("still walks a composition reached through an ENABLED reference after a disabled one to the same composition", () => {
    const manifest = buildTemplateManifest(
      facts([
        scene([precomp(1, "Hidden copy", "comp-inner", false), precomp(2, "Visible copy", "comp-inner", true)]),
        composition({ compositionId: "comp-inner", name: "Inner", parentCompositionIds: ["comp-root"], layers: [text(1, "Real Title")] })
      ]),
      fixedNow
    );

    expect(manifest.scenes[0]!.placeholders.map((p) => p.layerName)).toEqual(["Real Title"]);
    expect(manifest.scenes[0]!.placeholders[0]!.nestedTarget).toEqual([{ compositionId: "comp-inner", layerIndex: 1 }]);
  });

  it("treats a precomp layer with no scan entry (enabled: null) as walkable - never assumed disabled", () => {
    const manifest = buildTemplateManifest(
      facts([
        scene([precomp(1, "Unscanned", "comp-inner", null)]),
        composition({ compositionId: "comp-inner", name: "Inner", parentCompositionIds: ["comp-root"], layers: [text(1, "Title")] })
      ]),
      fixedNow
    );
    expect(manifest.scenes[0]!.placeholders).toHaveLength(1);
  });
});
