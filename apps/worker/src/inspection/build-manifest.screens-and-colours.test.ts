import { describe, expect, it } from "vitest";
import { templateManifestSchema, type Placeholder } from "@dyo/schemas";
import { buildTemplateManifest } from "./build-manifest.js";
import type { ScannedSlotLayer } from "./build-slot-facts.js";
import type { CompositionFact, LayerFact, PrecompChildFact, ProjectFacts } from "./project-facts.js";

/**
 * REAL 2026-10-02 MISS, on a ten-phone app-promo template: inspection found
 * every scene's text and nothing else. A client could not put a screenshot
 * in a single phone, nor change one colour, in a template built for exactly
 * that - each phone screen is a composition of one solid plus two drawn
 * shapes, and each scene's colours sit on Color Control effects.
 *
 * The compositions below are a made-up minimal graph of that SHAPE. Nothing
 * here is the real template's ids, names, sizes or counts.
 */

const MASTER = "comp-1";
const SCENE = "comp-2";
const RIG = "comp-3";
const CARD = "comp-4";

function layer(overrides: Partial<LayerFact> & Pick<LayerFact, "name" | "index">): LayerFact {
  return { layerKind: "Unknown", footage: null, solidFill: null, enabled: true, layerPath: [], startTimeSeconds: 0, durationSeconds: 5, ...overrides };
}
const solid = (index: number, name: string) => layer({ index, name, layerKind: "AVLayer", solidFill: { isUniformSolidFill: true } });
const shape = (index: number, name: string) => layer({ index, name, layerKind: "ShapeLayer" });
const text = (index: number, name: string) => layer({ index, name, layerKind: "TextLayer" });

function precomp(layerIndex: number, sourceCompositionId: string, extra: Partial<PrecompChildFact> = {}): PrecompChildFact {
  return { layerIndex, layerName: `to ${sourceCompositionId}`, sourceCompositionId, enabled: true, ...extra };
}

function composition(overrides: Partial<CompositionFact> & Pick<CompositionFact, "compositionId" | "name">): CompositionFact {
  return {
    aeProjectItemIndex: 1,
    widthPx: 1920,
    heightPx: 1080,
    durationSeconds: 10,
    frameRate: 30,
    isNestedOnlyReferenced: true,
    parentCompositionIds: [],
    layers: [],
    precompChildren: [],
    ...overrides
  };
}

function facts(compositions: CompositionFact[], scanned: Record<string, ScannedSlotLayer> = {}): ProjectFacts {
  return {
    templateId: "t",
    templateName: "T",
    aeVersion: null,
    sourceProjectPath: "C:\\work\\t.aep",
    sourceProjectName: "t.aep",
    projectSha256: "a".repeat(64),
    compositions,
    requiredFonts: [],
    footageReferenced: [],
    missingFootage: [],
    pluginReferences: [],
    layerFactsByCompositionAndIndex: new Map(Object.entries(scanned))
  };
}

/** master -> scene -> rig -> card. The rig places the card; `cardHostHasMatte` says whether through a track matte. */
function graph(card: CompositionFact, cardHostHasMatte: boolean, sceneLayers: LayerFact[] = []): CompositionFact[] {
  return [
    composition({ compositionId: MASTER, name: "Master", isNestedOnlyReferenced: false, precompChildren: [precomp(1, SCENE)] }),
    composition({ compositionId: SCENE, name: "Part", layers: sceneLayers, precompChildren: [precomp(9, RIG)] }),
    composition({ compositionId: RIG, name: "Rig", precompChildren: [precomp(1, CARD, { hasTrackMatte: cardHostHasMatte })] }),
    card
  ];
}

const placeholdersOf = (projectFacts: ProjectFacts): Placeholder[] =>
  buildTemplateManifest(projectFacts, () => new Date("2026-10-02T00:00:00.000Z")).scenes.flatMap((scene) => scene.placeholders);

const portraitCard = (layers: LayerFact[]) => composition({ compositionId: CARD, name: "Card", widthPx: 750, heightPx: 1334, layers });
const fullCardSolid: Record<string, ScannedSlotLayer> = { [`${CARD}:3`]: { kind: "AVLayer", footage: { isSolid: true, widthPx: 750, heightPx: 1334 } } };

describe("a screen made of a solid plus drawn shapes is an image slot", () => {
  it("shown through a matte: the solid is the one slot, the shapes are not offered", () => {
    const found = placeholdersOf(facts(graph(portraitCard([shape(1, "a"), shape(2, "b"), solid(3, "screen")]), true)));

    expect(found.map((p) => [p.placeholderType, p.layerName])).toEqual([["image", "screen"]]);
    expect(found[0]?.nestedTarget).toEqual([
      { compositionId: SCENE, layerIndex: 9 },
      { compositionId: RIG, layerIndex: 1 },
      { compositionId: CARD, layerIndex: 3 }
    ]);
    expect(found[0]?.slotSemantics).toBeDefined();
  });

  it("not matted, but a frame of its own size filled by its solid: still a slot", () => {
    const found = placeholdersOf(facts(graph(portraitCard([shape(1, "a"), solid(3, "screen")]), false), fullCardSolid));
    expect(found.map((p) => p.placeholderType)).toEqual(["image"]);
  });

  it("not matted and the size of the picture: a background, never a slot", () => {
    const card = composition({ compositionId: CARD, name: "Backdrop", layers: [shape(1, "a"), solid(3, "fill")] });
    const scanned = { [`${CARD}:3`]: { kind: "AVLayer", footage: { isSolid: true, widthPx: 1920, heightPx: 1080 } } };
    expect(placeholdersOf(facts(graph(card, false), scanned))).toEqual([]);
  });

  it("not matted and its solid does not fill it: never a slot", () => {
    const scanned = { [`${CARD}:3`]: { kind: "AVLayer", footage: { isSolid: true, widthPx: 100, heightPx: 100 } } };
    expect(placeholdersOf(facts(graph(portraitCard([shape(1, "a"), solid(3, "dot")]), false), scanned))).toEqual([]);
  });

  it("not matted and holding text: the text stays an editable text layer, nothing is hidden as a guide label", () => {
    const found = placeholdersOf(facts(graph(portraitCard([text(1, "Title"), shape(2, "a"), solid(3, "back")]), false), fullCardSolid));
    expect(found.map((p) => [p.placeholderType, p.layerName])).toEqual([["text", "Title"]]);
  });

  it("matted and holding text beside shapes: unchanged - the text is still offered, the card rule does not fire", () => {
    const found = placeholdersOf(facts(graph(portraitCard([text(1, "Title"), shape(2, "a"), solid(3, "back")]), true)));
    expect(found.map((p) => [p.placeholderType, p.layerName])).toEqual([["text", "Title"]]);
  });
});

describe("each Color Control effect is one editable colour", () => {
  const control = (name: string, extra: Partial<{ animated: boolean; hasExpression: boolean }> = {}) => ({
    name,
    matchName: "ADBE Color Control",
    colorControl: { red: 1, green: 0.5, blue: 0, animated: false, hasExpression: false, ...extra }
  });
  const emptyCard = composition({ compositionId: CARD, name: "Card" });

  it("finds them on a layer that is never itself content, in the effect's own order", () => {
    const scanned: Record<string, ScannedSlotLayer> = {
      [`${SCENE}:1`]: {
        kind: "AVLayer",
        layerName: "Controls",
        detail: { adjustmentLayer: true },
        effects: [{ name: "Blur", matchName: "ADBE Fast Blur" }, control("Titles"), control("Dots")]
      }
    };
    const found = placeholdersOf(facts(graph(emptyCard, false), scanned));

    expect(found.map((p) => [p.placeholderType, p.layerName, p.colorControl])).toEqual([
      ["color", "Controls \u203A Titles", { effectIndex: 2, effectName: "Titles", currentColorHex: "#FF8000" }],
      ["color", "Controls \u203A Dots", { effectIndex: 3, effectName: "Dots", currentColorHex: "#FF8000" }]
    ]);
    expect(found[0]?.nestedTarget).toEqual([{ compositionId: SCENE, layerIndex: 1 }]);
    expect(found[0]?.layerPath).toEqual(["Part"]);
    expect(new Set(found.map((p) => p.placeholderId)).size).toBe(2);
  });

  it("in the scene's own composition it carries no chain", () => {
    const scanned = { [`${MASTER}:5`]: { kind: "AVLayer", layerName: "Controls", effects: [control("Accent")] } };
    const found = placeholdersOf(facts(graph(emptyCard, false), scanned));
    expect(found.map((p) => [p.compositionId, p.layerIndex, p.nestedTarget])).toEqual([[MASTER, 5, null]]);
  });

  it("leaves out a colour that is animated, driven by an expression, or was never read", () => {
    const scanned: Record<string, ScannedSlotLayer> = {
      [`${SCENE}:1`]: {
        kind: "AVLayer",
        layerName: "Controls",
        effects: [control("Moving", { animated: true }), control("Linked", { hasExpression: true }), { name: "Unread", matchName: "ADBE Color Control" }, control("Free")]
      }
    };
    const found = placeholdersOf(facts(graph(emptyCard, false), scanned));
    expect(found.map((p) => p.colorControl)).toEqual([{ effectIndex: 4, effectName: "Free", currentColorHex: "#FF8000" }]);
  });

  it("survives the real manifest schema with its colour control intact", () => {
    const scanned = { [`${SCENE}:1`]: { kind: "AVLayer", layerName: "Controls", effects: [control("Titles")] } };
    const manifest = buildTemplateManifest(facts(graph(emptyCard, false), scanned), () => new Date("2026-10-02T00:00:00.000Z"));
    const parsed = templateManifestSchema.parse(manifest);
    expect(parsed.scenes[0]?.placeholders[0]?.colorControl).toEqual({ effectIndex: 1, effectName: "Titles", currentColorHex: "#FF8000" });
  });

  it("changes nothing for a template that has no colour controls", () => {
    const withText = graph(emptyCard, false, [text(2, "Headline")]);
    expect(placeholdersOf(facts(withText)).map((p) => [p.placeholderType, p.layerName])).toEqual([["text", "Headline"]]);
  });
});

describe("moving footage laid over the picture in a lightening blending mode is an effect, not a slot", () => {
  const clip = (index: number, name: string, isStill = false) =>
    layer({
      index,
      name,
      layerKind: "AVLayer",
      footage: { hasVideo: true, hasAudio: false, isStill, isMissing: false, widthPx: 1920, heightPx: 1080 }
    });
  const blended = (blendingMode: string | null): Record<string, ScannedSlotLayer> => ({
    [`${SCENE}:1`]: { kind: "AVLayer", detail: { blendingMode } }
  });
  const emptyCard = composition({ compositionId: CARD, name: "Card" });
  const typesOf = (sceneLayers: LayerFact[], scanned: Record<string, ScannedSlotLayer>) =>
    placeholdersOf(facts(graph(emptyCard, false, sceneLayers), scanned)).map((p) => [p.placeholderType, p.layerName]);

  it.each(["SCREEN", "ADD", "LIGHTEN", "LINEAR_DODGE"])("%s: not offered, and the text beside it still is", (mode) => {
    expect(typesOf([clip(1, "glow"), text(2, "Headline")], blended(mode))).toEqual([["text", "Headline"]]);
  });

  it("a clip in the normal mode is still the client's video slot", () => {
    expect(typesOf([clip(1, "clip")], blended("NORMAL"))).toEqual([["video", "clip"]]);
  });

  it("a clip whose blending mode was never read is still offered - unknown hides nothing", () => {
    expect(typesOf([clip(1, "clip")], blended(null))).toEqual([["video", "clip"]]);
    expect(typesOf([clip(1, "clip")], {})).toEqual([["video", "clip"]]);
  });

  it("a still picture in a lightening mode is left as it was", () => {
    expect(typesOf([clip(1, "photo", true)], blended("SCREEN")).map(([, name]) => name)).toEqual(["photo"]);
  });
});

describe("a nested slot's on-screen moment is stated in the scene's own timeline", () => {
  // master (60 s) places the scene part at 20 s; the part places the rig at 2 s;
  // the rig places the card from its start. The card's solid runs 0-5 s.
  const timing = (startTimeSeconds: number, inPointSeconds: number, outPointSeconds: number, extra: Record<string, unknown> = {}) => ({
    kind: "AVLayer",
    enabled: true,
    detail: { startTimeSeconds, stretchPercent: 100, timeRemapEnabled: false, inPointSeconds, outPointSeconds, hasTrackMatte: false, ...extra }
  });
  const scannedChain = (overrides: Record<string, ScannedSlotLayer> = {}): Record<string, ScannedSlotLayer> => ({
    [`${MASTER}:1`]: timing(20, 20, 30),
    [`${SCENE}:9`]: timing(2, 2, 10),
    [`${RIG}:1`]: timing(0, 0, 8, { hasTrackMatte: true }),
    [`${CARD}:3`]: { kind: "AVLayer", enabled: true, footage: { isSolid: true, widthPx: 750, heightPx: 1334 }, detail: { inPointSeconds: 0, outPointSeconds: 5 } },
    ...overrides
  });
  const slotOf = (scanned: Record<string, ScannedSlotLayer>) =>
    placeholdersOf(facts(graph(portraitCard([shape(1, "a"), solid(3, "screen")]), true), scanned)).find((p) => p.placeholderType === "image");

  it("carries the slot's window up every hop: 0-5 s in the card is 22-27 s in the scene", () => {
    expect(slotOf(scannedChain())?.slotFacts?.sceneWindow).toEqual({ compositionId: MASTER, startSeconds: 22, endSeconds: 27 });
  });

  it("is cut by a placing layer's own in and out points", () => {
    const window = slotOf(scannedChain({ [`${MASTER}:1`]: timing(20, 23, 25) }))?.slotFacts?.sceneWindow;
    expect(window).toEqual({ compositionId: MASTER, startSeconds: 23, endSeconds: 25 });
  });

  it("follows a stretched layer, still cut by the layer above it", () => {
    const stretched = { ...timing(2, 2, 20), detail: { ...timing(2, 2, 20).detail, stretchPercent: 200 } };
    expect(slotOf(scannedChain({ [`${SCENE}:9`]: stretched }))?.slotFacts?.sceneWindow).toEqual({ compositionId: MASTER, startSeconds: 22, endSeconds: 30 });
  });

  it.each([
    ["a time-remapped hop", { [`${SCENE}:9`]: timing(2, 2, 10, { timeRemapEnabled: true }) }],
    ["a hop whose timing was never read", { [`${RIG}:1`]: { kind: "AVLayer", enabled: true, detail: { hasTrackMatte: true } } }],
    ["a hop switched off", { [`${MASTER}:1`]: { ...timing(20, 20, 30), enabled: false } }]
  ])("records nothing for %s - unknown is never a guessed moment", (_name, overrides) => {
    const slot = slotOf(scannedChain(overrides as Record<string, ScannedSlotLayer>));
    expect(slot).toBeDefined();
    expect(slot?.slotFacts?.sceneWindow).toBeUndefined();
  });

  it("the manifest schema keeps it", () => {
    const manifest = buildTemplateManifest(facts(graph(portraitCard([shape(1, "a"), solid(3, "screen")]), true), scannedChain()), () => new Date("2026-10-04T00:00:00.000Z"));
    const parsed = templateManifestSchema.parse(manifest);
    expect(parsed.scenes[0]?.placeholders.find((p) => p.placeholderType === "image")?.slotFacts?.sceneWindow?.startSeconds).toBe(22);
  });
});
