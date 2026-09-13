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

/**
 * Real client-slot classification (2026-09-13). The structure below copies
 * the real layer inventory persisted by inspection job 3ef5cbe9 on the Mixkit
 * template: real composition ids, layer indices, disabled/guide flags and
 * track-matte wiring. The human decision recorded against that evidence is
 * exactly 9 client slots: the 6 phone 03-05 texts and 3 screen cards.
 */
describe("buildTemplateManifest - evidence-backed Mixkit client slots", () => {
  const R = {
    main: "comp-2144961805",
    s: { 1: "comp-2144954688", 2: "comp-2144954612", 3: "comp-2144960108", 4: "comp-2144954673", 5: "comp-2144954793" },
    pre: { 1: "comp-2144955123", 2: "comp-2144954880", 3: "comp-2144959908", 4: "comp-2144955085", 5: "comp-2144955389" },
    ph: { 1: "comp-2144951525", 2: "comp-2144961857", 3: "comp-2144950771", 4: "comp-2144951144", 5: "comp-2144956937" },
    ph01_1: "comp-749",
    ph01_2: "comp-773",
    mobile: "comp-252",
    app01: "comp-3270",
    app02: "comp-3284"
  } as const;
  type PhoneNumber = 1 | 2 | 3 | 4 | 5;
  const PHONES: PhoneNumber[] = [1, 2, 3, 4, 5];

  const renderVideo: FootageFact = { hasVideo: true, hasAudio: false, isStill: false, isMissing: false, widthPx: 1920, heightPx: 1080 };
  const solid = (index: number, name: string, extra: Partial<LayerFact> = {}) =>
    layer({ index, name, layerKind: "AVLayer", solidFill: { isUniformSolidFill: true }, ...extra });
  const matteClip = (index: number, name: string) =>
    layer({ index, name, layerKind: "AVLayer", footage: renderVideo, enabled: false, trackMatte: { isTrackMatte: true, hasTrackMatte: false, matteLayerIndex: null } });
  const mattedClip = (index: number, name: string, matteLayerIndex: number | null, clipFootage: FootageFact = renderVideo) =>
    layer({ index, name, layerKind: "AVLayer", footage: clipFootage, trackMatte: { isTrackMatte: false, hasTrackMatte: true, matteLayerIndex } });
  const camera = (index: number) => layer({ index, name: "Camera 1", layerKind: "CameraLayer" });
  const mattedPrecomp = (layerIndex: number, layerName: string, sourceCompositionId: string): PrecompChildFact => ({
    ...precomp(layerIndex, layerName, sourceCompositionId),
    hasTrackMatte: true
  });

  function realMixkit(): CompositionFact[] {
    const beauty = (n: number) => `Smartphone_0${n}_Beauty_Pass.mov`;
    return [
      composition({
        compositionId: R.main,
        name: "Main_Comp",
        isNestedOnlyReferenced: false,
        layers: [solid(1, "CONTROLS", { enabled: false, guideLayer: true })],
        precompChildren: PHONES.map((n) => precomp(7 - n, `Smartphone_0${n}`, R.s[n]))
      }),
      composition({
        compositionId: R.s[1],
        name: "Smartphone_01",
        parentCompositionIds: [R.main],
        layers: [solid(5, "BG Color 2"), solid(6, "BG Color 1")],
        precompChildren: [
          precomp(1, "Smartphone_01_PreComp", R.pre[1]),
          precomp(2, "Placeholder_01", R.ph[1], false),
          precomp(3, "Placeholder_01-1", R.ph01_1, false),
          precomp(4, "Placeholder_01-2", R.ph01_2, false)
        ]
      }),
      composition({
        compositionId: R.s[2],
        name: "Smartphone_02",
        parentCompositionIds: [R.main],
        layers: [solid(3, "BG Color 2"), solid(4, "BG Color 1")],
        precompChildren: [precomp(1, "Smartphone_02_PreComp", R.pre[2]), precomp(2, "Placeholder_02", R.ph[2], false)]
      }),
      ...([3, 4, 5] as const).map((n) =>
        composition({
          compositionId: R.s[n],
          name: `Smartphone_0${n}`,
          parentCompositionIds: [R.main],
          layers: [text(1, "Text 2"), text(2, "Text 1"), solid(5, "BG Color 2"), solid(6, "BG Color 1")],
          precompChildren: [precomp(3, `Smartphone_0${n}_PreComp`, R.pre[n]), precomp(4, `Placeholder_0${n}`, R.ph[n], false)]
        })
      ),
      composition({
        compositionId: R.pre[1],
        name: "Smartphone_01_PreComp",
        parentCompositionIds: [R.s[1]],
        layers: [
          camera(1),
          matteClip(3, "Smartphone_01_All_Placeholders_Mask.mov"),
          mattedClip(4, beauty(1), 3),
          matteClip(6, "Smartphone_01_Placeholder_Mask_1+2.mov"),
          matteClip(9, "Smartphone_01_Placeholder_Mask_1+2.mov"),
          matteClip(11, "Smartphone_01_Placeholder_Mask.mov"),
          matteClip(13, "Smartphone_01_Mask.mov"),
          mattedClip(14, beauty(1), 13)
        ],
        precompChildren: [
          mattedPrecomp(7, "Placeholder_01-1", R.ph01_1),
          mattedPrecomp(10, "Placeholder_01-2", R.ph01_2),
          mattedPrecomp(12, "Placeholder_01", R.ph[1])
        ]
      }),
      ...([2, 3, 4, 5] as const).map((n) =>
        composition({
          compositionId: R.pre[n],
          name: `Smartphone_0${n}_PreComp`,
          parentCompositionIds: [R.s[n]],
          layers: [
            camera(1),
            matteClip(3, `Smartphone_0${n}_Placeholder_Mask.mov`),
            mattedClip(4, beauty(n), 3),
            matteClip(5, `Smartphone_0${n}_Placeholder_Mask.mov`),
            matteClip(7, `Smartphone_0${n}_Mask.mov`),
            mattedClip(8, beauty(n), 7)
          ],
          precompChildren: [mattedPrecomp(6, `Placeholder_0${n}`, R.ph[n])]
        })
      ),
      ...PHONES.map((n) =>
        composition({
          compositionId: R.ph[n],
          name: `Placeholder_0${n}`,
          parentCompositionIds: [R.pre[n], R.s[n]],
          precompChildren: [precomp(1, "_Place_Image_Above_Mobile", R.mobile)]
        })
      ),
      composition({
        compositionId: R.ph01_1,
        name: "Placeholder_01-1",
        parentCompositionIds: [R.pre[1], R.s[1]],
        precompChildren: [precomp(1, "_Place Image Above_App Screen 01", R.app01)]
      }),
      composition({
        compositionId: R.ph01_2,
        name: "Placeholder_01-2",
        parentCompositionIds: [R.pre[1], R.s[1]],
        precompChildren: [precomp(1, "_Place Image Above_App Screen 02", R.app02)]
      }),
      composition({
        compositionId: R.mobile,
        name: "_Place_Image_Above_Mobile",
        parentCompositionIds: PHONES.map((n) => R.ph[n]),
        layers: [text(1, "PLACE YOUR IMAGE HERE"), solid(2, "BG")]
      }),
      composition({
        compositionId: R.app01,
        name: "_Place Image Above_App Screen 01",
        parentCompositionIds: [R.ph01_1],
        layers: [text(1, "APP SCREEN "), text(2, "1"), solid(3, "Placeholder")]
      }),
      composition({
        compositionId: R.app02,
        name: "_Place Image Above_App Screen 02",
        parentCompositionIds: [R.ph01_2],
        layers: [text(1, "APP SCREEN "), text(2, "2"), solid(3, "Placeholder")]
      })
    ];
  }

  const slot = (p: Placeholder) => `${p.compositionId}#${p.layerIndex} ${p.layerName} (${p.placeholderType})`;

  it("exposes exactly 9 client slots - 6 phone 03-05 texts and 3 screen cards - in AE stacking order", () => {
    const manifest = buildTemplateManifest(facts(realMixkit()), fixedNow);
    const placeholders = scenePlaceholders(manifest);

    expect(placeholders.map(slot)).toEqual([
      `${R.s[5]}#1 Text 2 (text)`,
      `${R.s[5]}#2 Text 1 (text)`,
      `${R.mobile}#2 BG (image)`,
      `${R.s[4]}#1 Text 2 (text)`,
      `${R.s[4]}#2 Text 1 (text)`,
      `${R.s[3]}#1 Text 2 (text)`,
      `${R.s[3]}#2 Text 1 (text)`,
      `${R.app01}#3 Placeholder (image)`,
      `${R.app02}#3 Placeholder (image)`
    ]);
    expect(placeholders.every((p) => p.editable)).toBe(true);
    expect(computeInspectionSummary(manifest).editablePlaceholderCount).toBe(9);
    expect(manifest.unknownItems).toEqual([]);
  });

  it("excludes all 10 Beauty_Pass uses, every guide label, and CONTROLS", () => {
    const names = scenePlaceholders(buildTemplateManifest(facts(realMixkit()), fixedNow)).map((p) => p.layerName);

    expect(names.filter((name) => name.includes("Beauty_Pass"))).toEqual([]);
    for (const guide of ["PLACE YOUR IMAGE HERE", "APP SCREEN ", "1", "2", "CONTROLS"]) {
      expect(names).not.toContain(guide);
    }
    // 22 before = 10 Beauty_Pass + 5 guide labels + CONTROLS + 6 texts; the 5 guide labels are
    // replaced by the 3 card slots they sat on, so 22 - 10 - 5 - 1 + 3 = 9.
    expect(names).toHaveLength(22 - 10 - 5 - 1 + 3);
  });

  it("targets each screen card through a chain dispatch accepts, via the enabled matted route only", () => {
    const manifest = buildTemplateManifest(facts(realMixkit()), fixedNow);
    const cards = scenePlaceholders(manifest).filter((p) => p.placeholderType === "image");

    expect(cards.find((p) => p.compositionId === R.mobile)!.nestedTarget).toEqual([
      { compositionId: R.s[5], layerIndex: 3 },
      { compositionId: R.pre[5], layerIndex: 6 },
      { compositionId: R.ph[5], layerIndex: 1 },
      { compositionId: R.mobile, layerIndex: 2 }
    ]);
    for (const card of cards) {
      assertChainVerifies(manifest, R.main, card.nestedTarget!);
      expect(card.evidence.source).toBe("inferred");
    }
  });

  it("keeps a title card that is NOT shown through a matte as a text slot - the card rule needs the matte", () => {
    const manifest = buildTemplateManifest(
      facts([
        composition({ compositionId: "comp-root", name: "Root", isNestedOnlyReferenced: false, precompChildren: [precomp(1, "Lower Third", "comp-lt")] }),
        composition({ compositionId: "comp-lt", name: "Lower Third", parentCompositionIds: ["comp-root"], layers: [text(1, "Name"), solid(2, "Bar")] })
      ]),
      fixedNow
    );

    expect(manifest.scenes[0]!.placeholders.map(slot)).toEqual(["comp-lt#1 Name (text)"]);
  });

  it("keeps a client video cut by a solid matte as a video slot - only a VIDEO matte marks a pre-rendered pass", () => {
    const manifest = buildTemplateManifest(
      facts([
        composition({ compositionId: "comp-root", name: "Root", isNestedOnlyReferenced: false, precompChildren: [precomp(1, "Window", "comp-w")] }),
        composition({
          compositionId: "comp-w",
          name: "Window",
          parentCompositionIds: ["comp-root"],
          layers: [solid(1, "Window Mask", { enabled: false, trackMatte: { isTrackMatte: true, hasTrackMatte: false, matteLayerIndex: null } }), mattedClip(2, "client.mp4", 1, video)]
        })
      ]),
      fixedNow
    );

    expect(manifest.scenes[0]!.placeholders.map(slot)).toEqual(["comp-w#2 client.mp4 (video)"]);
  });

  it("never treats a matted composition with its own matte wiring as a screen card - filling it would reorder layers and break the matte", () => {
    const manifest = buildTemplateManifest(
      facts([
        composition({ compositionId: "comp-root", name: "Root", isNestedOnlyReferenced: false, precompChildren: [mattedPrecomp(1, "Screen", "comp-screen")] }),
        composition({
          compositionId: "comp-screen",
          name: "Screen",
          parentCompositionIds: ["comp-root"],
          layers: [
            solid(1, "Inner Mask", { enabled: false, trackMatte: { isTrackMatte: true, hasTrackMatte: false, matteLayerIndex: null } }),
            text(2, "Status Bar Time", { trackMatte: { isTrackMatte: false, hasTrackMatte: true, matteLayerIndex: 1 } }),
            solid(3, "Card")
          ]
        })
      ]),
      fixedNow
    );

    expect(manifest.scenes[0]!.placeholders.map(slot)).toEqual(["comp-screen#2 Status Bar Time (text)"]);
  });

  it("recognises a pre-rendered pass on an AE build without trackMatteLayer, where the matte is the layer directly above", () => {
    const manifest = buildTemplateManifest(
      facts([
        composition({ compositionId: "comp-root", name: "Root", isNestedOnlyReferenced: false, precompChildren: [precomp(1, "Rig", "comp-rig")] }),
        composition({ compositionId: "comp-rig", name: "Rig", parentCompositionIds: ["comp-root"], layers: [matteClip(1, "Body_Mask.mov"), mattedClip(2, "Body_Pass.mov", null)] })
      ]),
      fixedNow
    );

    expect(manifest.scenes[0]!.placeholders).toEqual([]);
    expect(manifest.unknownItems).toEqual([]);
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
