import { describe, expect, it } from "vitest";
import { buildTemplateManifest } from "./build-manifest.js";
import type { CompositionFact, FootageFact, LayerFact, PrecompChildFact, ProjectFacts } from "./project-facts.js";

/**
 * REAL 2026-11-02 (client project 08b28fd1, "app promo" template, Scene 06):
 * two phones, each a PRE-RENDERED image sequence of the hardware the size of
 * the scene, each with a "Holder 06-x" composition (1284x2778) placed by a
 * layer parented to a world-transform null. Inside the holder: a "DELETE"
 * shape with a Checkerboard effect as the matte, and an inner "Holder 06-x"
 * composition whose only layer is switched off. The client's screenshots
 * were offered the phone sequences and replaced the hardware. The graph
 * below is that scene, shaped from the real inspection's layer inventory.
 */
const sequence: FootageFact = { hasVideo: true, hasAudio: false, isStill: false, isMissing: false, widthPx: 1920, heightPx: 1080 };
function layer(overrides: Partial<LayerFact> & Pick<LayerFact, "name" | "index">): LayerFact {
  return { layerKind: "Unknown", footage: null, solidFill: null, enabled: true, layerPath: [], startTimeSeconds: 0, durationSeconds: 6.7, ...overrides };
}
const precomp = (layerIndex: number, layerName: string, sourceCompositionId: string, extra: Partial<PrecompChildFact> = {}): PrecompChildFact => ({
  layerIndex,
  layerName,
  sourceCompositionId,
  enabled: true,
  ...extra
});
function composition(overrides: Partial<CompositionFact> & Pick<CompositionFact, "compositionId" | "name">): CompositionFact {
  return { aeProjectItemIndex: 1, widthPx: 1920, heightPx: 1080, durationSeconds: 6.7, frameRate: 25, isNestedOnlyReferenced: true, parentCompositionIds: [], layers: [], precompChildren: [], ...overrides };
}
function facts(compositions: CompositionFact[]): ProjectFacts {
  return {
    templateId: "app-promo",
    templateName: "App Promo",
    aeVersion: "26.3x87",
    sourceProjectPath: "C:\\DYO-Agent\\copies\\app-promo\\App Promo.aep",
    sourceProjectName: "App Promo.aep",
    projectSha256: "4172ee082c1ce15f9e180d17e128434d4b54a40b3596402e1a30e496415deafd",
    compositions,
    requiredFonts: [],
    footageReferenced: [],
    missingFootage: [],
    pluginReferences: [],
    layerFactsByCompositionAndIndex: new Map()
  };
}
const fixedNow = () => new Date("2026-11-02T00:00:00.000Z");

function scene06(): CompositionFact[] {
  return [
    composition({
      compositionId: "comp-1456",
      name: "Scene 06",
      isNestedOnlyReferenced: false,
      layers: [
        layer({ index: 4, name: "Scene 06_2_[00000-00167].png", layerKind: "AVLayer", footage: sequence }),
        layer({ index: 8, name: "Scene 06_1_[00000-00167].png", layerKind: "AVLayer", footage: sequence }),
        layer({ index: 10, name: "Mobile App Promo", layerKind: "TextLayer", sourceText: "Mobile App Promo" })
      ],
      precompChildren: [
        precomp(1, "Holder 06-1", "comp-1428"),
        precomp(2, "Holder 06-1", "comp-1428"),
        precomp(5, "Holder 06-2", "comp-1442"),
        precomp(6, "Holder 06-2", "comp-1442"),
        precomp(19, "Holder 06-1", "comp-1401", { enabled: false })
      ]
    }),
    composition({
      compositionId: "comp-1428",
      name: "Holder 06-1",
      widthPx: 1284,
      heightPx: 2778,
      parentCompositionIds: ["comp-1456"],
      layers: [layer({ index: 1, name: "DELETE", layerKind: "ShapeLayer", trackMatte: { isTrackMatte: true, hasTrackMatte: false, matteLayerIndex: null } })],
      precompChildren: [precomp(2, "Holder 06-1", "comp-1401", { hasTrackMatte: true })]
    }),
    composition({
      compositionId: "comp-1401",
      name: "Holder 06-1",
      widthPx: 1284,
      heightPx: 2778,
      parentCompositionIds: ["comp-1428", "comp-1456"],
      layers: [layer({ index: 1, name: "Shape Layer 1", layerKind: "ShapeLayer", enabled: false })]
    }),
    composition({
      compositionId: "comp-1442",
      name: "Holder 06-2",
      widthPx: 1284,
      heightPx: 2778,
      parentCompositionIds: ["comp-1456"],
      layers: [layer({ index: 1, name: "DELETE", layerKind: "ShapeLayer", trackMatte: { isTrackMatte: true, hasTrackMatte: false, matteLayerIndex: null } })],
      precompChildren: [precomp(2, "Holder 06-2", "comp-1414", { hasTrackMatte: true })]
    }),
    composition({
      compositionId: "comp-1414",
      name: "Holder 06-2",
      widthPx: 1284,
      heightPx: 2778,
      parentCompositionIds: ["comp-1442"],
      layers: [layer({ index: 1, name: "Shape Layer 1", layerKind: "ShapeLayer", enabled: false })]
    })
  ];
}

describe("buildTemplateManifest - an empty holder composition is the screen slot, and the pre-rendered hardware beside it is not", () => {
  it("lists one image slot per holder, targeting the layer that places the empty inner holder, with the holder's own size", () => {
    const manifest = buildTemplateManifest(facts(scene06()), fixedNow);
    const scene = manifest.scenes.find((s) => s.compositionId === "comp-1456");
    expect(scene).toBeDefined();
    const images = scene!.placeholders.filter((p) => p.placeholderType === "image");
    expect(images.map((p) => `${p.compositionId}:${p.layerIndex} ${p.layerName}`)).toEqual(["comp-1428:2 Holder 06-1", "comp-1442:2 Holder 06-2"]);
    // Chains never start with the scene's own composition (see collectNestedPlaceholders).
    expect(images[0]!.nestedTarget).toEqual([{ compositionId: "comp-1428", layerIndex: 2 }]);
    expect(images[0]!.dimensions).toEqual({ width: 1284, height: 2778 });
    expect(images[0]!.evidence.reason).toContain("draws nothing");
    expect(images[0]!.slotFacts).toBeDefined();
  });

  it("never offers the scene-sized pre-rendered phone sequences as video slots - the text stays", () => {
    const manifest = buildTemplateManifest(facts(scene06()), fixedNow);
    const scene = manifest.scenes.find((s) => s.compositionId === "comp-1456")!;
    expect(scene.placeholders.filter((p) => p.placeholderType === "video")).toEqual([]);
    expect(scene.placeholders.some((p) => p.layerName === "Scene 06_2_[00000-00167].png")).toBe(false);
    expect(scene.placeholders.some((p) => p.placeholderType === "text" && p.layerName === "Mobile App Promo")).toBe(true);
  });

  it("a scene-sized empty composition is a spacer, never a slot, and a full-frame sequence beside no holder stays a video slot", () => {
    const spacer = composition({ compositionId: "comp-9", name: "Spacer", widthPx: 1920, heightPx: 1080, parentCompositionIds: ["comp-1"], layers: [layer({ index: 1, name: "off", enabled: false })] });
    const sceneComp = composition({
      compositionId: "comp-1",
      name: "Scene 01",
      isNestedOnlyReferenced: false,
      layers: [layer({ index: 2, name: "clip.mp4", layerKind: "AVLayer", footage: sequence })],
      precompChildren: [precomp(1, "Spacer", "comp-9")]
    });
    const manifest = buildTemplateManifest(facts([sceneComp, spacer]), fixedNow);
    const scene = manifest.scenes.find((s) => s.compositionId === "comp-1")!;
    expect(scene.placeholders.map((p) => `${p.layerName} (${p.placeholderType})`)).toEqual(["clip.mp4 (video)"]);
  });
});
