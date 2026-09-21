import { describe, expect, it } from "vitest";
import { classifySlotSemantics, computeSlotFingerprint } from "@dyo/schemas";
import { buildSlotStructuralFacts, type ScannedSlotLayer } from "./build-slot-facts.js";
import type { CompositionFact, LayerFact } from "./project-facts.js";

/**
 * SYNTHETIC GRAPHS, NOT ONE REAL TEMPLATE. Each fixture is a composition
 * SHAPE - a rendered-matte phone screen, a drawn-mask card, a precomp reused
 * by two parents - assembled by hand, so nothing here depends on any real
 * project's names, ids or hierarchy.
 */
function layer(overrides: Partial<LayerFact> & { index: number }): LayerFact {
  return {
    name: `layer-${overrides.index}`,
    layerKind: "AVLayer",
    footage: null,
    solidFill: null,
    enabled: true,
    layerPath: [],
    startTimeSeconds: 0,
    durationSeconds: 5,
    ...overrides
  };
}

function composition(overrides: Partial<CompositionFact> & { compositionId: string }): CompositionFact {
  return {
    aeProjectItemIndex: 1,
    name: `comp ${overrides.compositionId}`,
    widthPx: 1000,
    heightPx: 1000,
    durationSeconds: 5,
    frameRate: 30,
    isNestedOnlyReferenced: false,
    parentCompositionIds: [],
    layers: [],
    precompChildren: [],
    ...overrides
  };
}

function scanned(overrides: { kind?: string; footage?: ScannedSlotLayer["footage"]; detail?: ScannedSlotLayer["detail"] } = {}): ScannedSlotLayer {
  return { kind: "AVLayer", footage: null, detail: null, ...overrides };
}

describe("buildSlotStructuralFacts - matte source is read from what the matte is MADE OF", () => {
  const slotComposition = composition({ compositionId: "comp-slot", widthPx: 1200, heightPx: 2600, layers: [layer({ index: 1 })] });

  function graph(matteLayer: ScannedSlotLayer, hostDetail: ScannedSlotLayer["detail"] = { hasTrackMatte: true, trackMatteLayerIndex: 2 }) {
    const host = composition({
      compositionId: "comp-host",
      layers: [layer({ index: 2, name: "matte" })],
      precompChildren: [{ layerIndex: 3, layerName: "host", sourceCompositionId: "comp-slot", enabled: true }]
    });
    const scan = new Map<string, ScannedSlotLayer>([
      ["comp-host:3", scanned({ detail: hostDetail })],
      ["comp-host:2", matteLayer]
    ]);
    return buildSlotStructuralFacts({
      slotComposition,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [slotComposition, host],
      layerFactsByCompositionAndIndex: scan,
      hostDepth: 1,
      slotIsWholeComposition: true
    });
  }

  it("calls a matte made from rendered video footage RENDERED_FOOTAGE", () => {
    const facts = graph(scanned({ footage: { hasVideo: true, isStill: false, isSolid: false } }));
    expect(facts.hosts[0]?.matteSource).toBe("RENDERED_FOOTAGE");
    expect(classifySlotSemantics(facts).classification).toBe("device_screen");
  });

  it("calls a solid matte DRAWN_MASK_OR_SOLID", () => {
    const facts = graph(scanned({ footage: { hasVideo: false, isStill: true, isSolid: true } }));
    expect(facts.hosts[0]?.matteSource).toBe("DRAWN_MASK_OR_SOLID");
  });

  it("calls a shape-layer matte DRAWN_MASK_OR_SOLID", () => {
    expect(graph(scanned({ kind: "ShapeLayer" })).hosts[0]?.matteSource).toBe("DRAWN_MASK_OR_SOLID");
  });

  it("calls a still-image matte DRAWN_MASK_OR_SOLID - an authored shape, not rendered hardware", () => {
    expect(graph(scanned({ footage: { hasVideo: false, isStill: true, isSolid: false } })).hosts[0]?.matteSource).toBe("DRAWN_MASK_OR_SOLID");
  });

  it("falls back to the layer directly above when After Effects does not name the matte layer", () => {
    const facts = graph(scanned({ footage: { hasVideo: true, isStill: false, isSolid: false } }), { hasTrackMatte: true, trackMatteLayerIndex: null, parentLayerIndex: null });
    // Host is layer 3, so the matte is layer 2 - the one the fixture provides.
    expect(facts.hosts[0]?.matteSource).toBe("RENDERED_FOOTAGE");
  });

  it("says UNKNOWN - never guesses - when the matte layer was not scanned", () => {
    const host = composition({
      compositionId: "comp-host",
      precompChildren: [{ layerIndex: 3, layerName: "host", sourceCompositionId: "comp-slot", enabled: true }]
    });
    const facts = buildSlotStructuralFacts({
      slotComposition,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [slotComposition, host],
      layerFactsByCompositionAndIndex: new Map([["comp-host:3", scanned({ detail: { hasTrackMatte: true, trackMatteLayerIndex: 9 } })]]),
      hostDepth: 1,
      slotIsWholeComposition: true
    });
    expect(facts.hosts[0]?.matteSource).toBe("UNKNOWN");
  });

  it("says NONE when After Effects positively reports no track matte", () => {
    expect(graph(scanned(), { hasTrackMatte: false }).hosts[0]?.matteSource).toBe("NONE");
  });

  it("says UNKNOWN when the whole scan is missing - an old worker build lowers confidence rather than arguing a side", () => {
    const host = composition({ compositionId: "comp-host", precompChildren: [{ layerIndex: 3, layerName: "h", sourceCompositionId: "comp-slot", enabled: true }] });
    const facts = buildSlotStructuralFacts({
      slotComposition,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [slotComposition, host],
      layerFactsByCompositionAndIndex: undefined,
      hostDepth: 1,
      slotIsWholeComposition: true
    });
    expect(facts.hosts[0]?.matteSource).toBe("UNKNOWN");
    expect(facts.hosts[0]?.threeDLayer).toBeNull();
    expect(classifySlotSemantics(facts).requiresHumanDecision).toBe(true);
  });
});

describe("buildSlotStructuralFacts - hosts, reuse and geometry", () => {
  it("finds every host that pulls the same slot composition in, wherever it lives", () => {
    const slotComposition = composition({ compositionId: "comp-slot", widthPx: 800, heightPx: 1600 });
    const first = composition({ compositionId: "comp-a", precompChildren: [{ layerIndex: 2, layerName: "a", sourceCompositionId: "comp-slot", enabled: true }] });
    const second = composition({ compositionId: "comp-b", precompChildren: [{ layerIndex: 7, layerName: "b", sourceCompositionId: "comp-slot", enabled: true }] });
    const other = composition({ compositionId: "comp-c", precompChildren: [{ layerIndex: 1, layerName: "c", sourceCompositionId: "comp-elsewhere", enabled: true }] });

    const facts = buildSlotStructuralFacts({
      slotComposition,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [slotComposition, first, second, other],
      layerFactsByCompositionAndIndex: new Map(),
      hostDepth: 2,
      slotIsWholeComposition: true
    });

    expect(facts.hosts.map((host) => host.compositionId)).toEqual(["comp-a", "comp-b"]);
    expect(facts.reusedByHostCount).toBe(2);
    expect(facts.hostDepth).toBe(2);
  });

  it("reads a host's 3D state, parent and animated-parent facts from the scan", () => {
    const slotComposition = composition({ compositionId: "comp-slot" });
    const host = composition({ compositionId: "comp-host", precompChildren: [{ layerIndex: 5, layerName: "host", sourceCompositionId: "comp-slot", enabled: true }] });
    const facts = buildSlotStructuralFacts({
      slotComposition,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [slotComposition, host],
      layerFactsByCompositionAndIndex: new Map([
        ["comp-host:5", scanned({ detail: { threeDLayer: true, parentLayerIndex: 2, scalePercent: 14, rotationDegrees: 3, hasTrackMatte: false } })],
        ["comp-host:2", scanned({ detail: { hasTransformKeyframes: true } })]
      ]),
      hostDepth: 1,
      slotIsWholeComposition: true
    });

    expect(facts.hosts[0]).toMatchObject({ threeDLayer: true, parentLayerIndex: 2, parentIsAnimated: true, scalePercent: 14, rotationDegrees: 3 });
  });

  it("reports a static parent as not animated, and an unscanned parent as unknown", () => {
    const slotComposition = composition({ compositionId: "comp-slot" });
    const host = composition({ compositionId: "comp-host", precompChildren: [{ layerIndex: 5, layerName: "h", sourceCompositionId: "comp-slot", enabled: true }] });
    const withStatic = buildSlotStructuralFacts({
      slotComposition,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [slotComposition, host],
      layerFactsByCompositionAndIndex: new Map([
        ["comp-host:5", scanned({ detail: { parentLayerIndex: 2 } })],
        ["comp-host:2", scanned({ detail: { hasTransformKeyframes: false } })]
      ]),
      hostDepth: 1,
      slotIsWholeComposition: true
    });
    expect(withStatic.hosts[0]?.parentIsAnimated).toBe(false);

    const withUnscannedParent = buildSlotStructuralFacts({
      slotComposition,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [slotComposition, host],
      layerFactsByCompositionAndIndex: new Map([["comp-host:5", scanned({ detail: { parentLayerIndex: 2 } })]]),
      hostDepth: 1,
      slotIsWholeComposition: true
    });
    expect(withUnscannedParent.hosts[0]?.parentIsAnimated).toBeNull();
  });

  it("detects a pre-rendered pass sibling, and reports false only when siblings were genuinely scanned", () => {
    const slotComposition = composition({ compositionId: "comp-slot" });
    const host = composition({
      compositionId: "comp-host",
      layers: [layer({ index: 1, name: "beauty pass" }), layer({ index: 2, name: "beauty matte" })],
      precompChildren: [{ layerIndex: 5, layerName: "h", sourceCompositionId: "comp-slot", enabled: true }]
    });
    const withPass = buildSlotStructuralFacts({
      slotComposition,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [slotComposition, host],
      layerFactsByCompositionAndIndex: new Map([
        ["comp-host:5", scanned({ detail: { hasTrackMatte: false } })],
        ["comp-host:1", scanned({ footage: { hasVideo: true, isStill: false, isSolid: false }, detail: { hasTrackMatte: true, trackMatteLayerIndex: 2 } })],
        ["comp-host:2", scanned({ footage: { hasVideo: true, isStill: false, isSolid: false } })]
      ]),
      hostDepth: 1,
      slotIsWholeComposition: true
    });
    expect(withPass.hosts[0]?.siblingPreRenderedPass).toBe(true);

    const withoutPass = buildSlotStructuralFacts({
      slotComposition,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [slotComposition, host],
      layerFactsByCompositionAndIndex: new Map([
        ["comp-host:5", scanned({ detail: { hasTrackMatte: false } })],
        ["comp-host:1", scanned({ detail: { hasTrackMatte: false } })],
        ["comp-host:2", scanned({ detail: { hasTrackMatte: false } })]
      ]),
      hostDepth: 1,
      slotIsWholeComposition: true
    });
    expect(withoutPass.hosts[0]?.siblingPreRenderedPass).toBe(false);
  });

  it("computes transformed bounds only when every host scale is known", () => {
    const slotComposition = composition({ compositionId: "comp-slot", widthPx: 1000, heightPx: 2000 });
    const host = composition({ compositionId: "comp-host", precompChildren: [{ layerIndex: 5, layerName: "h", sourceCompositionId: "comp-slot", enabled: true }] });
    const known = buildSlotStructuralFacts({
      slotComposition,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [slotComposition, host],
      layerFactsByCompositionAndIndex: new Map([["comp-host:5", scanned({ detail: { scalePercent: 25 } })]]),
      hostDepth: 1,
      slotIsWholeComposition: true
    });
    expect(known.transformedBounds).toEqual({ widthPx: 250, heightPx: 500 });

    const unknown = buildSlotStructuralFacts({
      slotComposition,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [slotComposition, host],
      layerFactsByCompositionAndIndex: new Map([["comp-host:5", scanned({ detail: {} })]]),
      hostDepth: 1,
      slotIsWholeComposition: true
    });
    expect(unknown.transformedBounds).toBeNull();
  });

  it("takes the slot's own pixel size from its layer's footage when it has one, and from the composition otherwise", () => {
    const withFootage = composition({
      compositionId: "comp-slot",
      widthPx: 1000,
      heightPx: 1000,
      layers: [layer({ index: 1, footage: { hasVideo: false, hasAudio: false, isStill: true, isMissing: false, widthPx: 640, heightPx: 480 } })]
    });
    const facts = buildSlotStructuralFacts({
      slotComposition: withFootage,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [withFootage],
      layerFactsByCompositionAndIndex: new Map(),
      hostDepth: 0,
      slotIsWholeComposition: true
    });
    expect(facts.widthPx).toBe(640);
    expect(facts.heightPx).toBe(480);
  });
});

describe("buildSlotStructuralFacts - a footage layer carries its own structure", () => {
  it("reads the slot LAYER's own matte, 3D state and parent when the slot is not a whole composition", () => {
    const scene = composition({
      compositionId: "comp-scene",
      layers: [layer({ index: 4, name: "the slot" }), layer({ index: 3, name: "matte" }), layer({ index: 9, name: "helper" })]
    });
    const facts = buildSlotStructuralFacts({
      slotComposition: scene,
      slotLayerIndex: 4,
      slotLayerName: "the slot",
      compositions: [scene],
      layerFactsByCompositionAndIndex: new Map([
        ["comp-scene:4", scanned({ detail: { hasTrackMatte: true, trackMatteLayerIndex: 3, threeDLayer: true, parentLayerIndex: 9, inPointSeconds: 1, outPointSeconds: 4 } })],
        ["comp-scene:3", scanned({ footage: { hasVideo: true, isStill: false, isSolid: false } })],
        ["comp-scene:9", scanned({ detail: { hasTransformKeyframes: true } })]
      ]),
      hostDepth: 0,
      slotIsWholeComposition: false
    });

    expect(facts.hosts).toHaveLength(1);
    expect(facts.hosts[0]).toMatchObject({ compositionId: "comp-scene", layerIndex: 4, threeDLayer: true, matteSource: "RENDERED_FOOTAGE", parentIsAnimated: true });
    // The slot itself is not a PLACEMENT of itself.
    expect(facts.reusedByHostCount).toBe(0);
    expect(facts.visibleWindowSeconds).toEqual({ startSeconds: 1, endSeconds: 4 });
    expect(classifySlotSemantics(facts).classification).toBe("device_screen");
  });

  it("classifies a plain top-level footage layer as a flat card instead of leaving it unknowable", () => {
    const scene = composition({ compositionId: "comp-scene", widthPx: 1920, heightPx: 1080, layers: [layer({ index: 2, name: "an image" })] });
    const facts = buildSlotStructuralFacts({
      slotComposition: scene,
      slotLayerIndex: 2,
      slotLayerName: "an image",
      compositions: [scene],
      layerFactsByCompositionAndIndex: new Map([
        ["comp-scene:2", scanned({ detail: { hasTrackMatte: false, threeDLayer: false, parentLayerIndex: null, inPointSeconds: 0, outPointSeconds: 5 } })]
      ]),
      hostDepth: 0,
      slotIsWholeComposition: false
    });

    const verdict = classifySlotSemantics(facts);
    expect(verdict.classification).toBe("flat_card");
    expect(verdict.requiresHumanDecision).toBe(false);
  });

  it("still counts real placements of the slot's own composition alongside the layer's own facts", () => {
    const inner = composition({ compositionId: "comp-inner", layers: [layer({ index: 1 })] });
    const hostA = composition({ compositionId: "comp-a", precompChildren: [{ layerIndex: 2, layerName: "a", sourceCompositionId: "comp-inner", enabled: true }] });
    const hostB = composition({ compositionId: "comp-b", precompChildren: [{ layerIndex: 3, layerName: "b", sourceCompositionId: "comp-inner", enabled: true }] });
    const facts = buildSlotStructuralFacts({
      slotComposition: inner,
      slotLayerIndex: 1,
      slotLayerName: null,
      compositions: [inner, hostA, hostB],
      layerFactsByCompositionAndIndex: new Map([["comp-inner:1", scanned({ detail: { hasTrackMatte: false, threeDLayer: false } })]]),
      hostDepth: 1,
      slotIsWholeComposition: false
    });

    expect(facts.hosts.map((host) => `${host.compositionId}:${host.layerIndex}`)).toEqual(["comp-inner:1", "comp-a:2", "comp-b:3"]);
    expect(facts.reusedByHostCount).toBe(2);
  });
});

describe("buildSlotStructuralFacts - order independence", () => {
  it("produces the same facts and the same fingerprint however the project's compositions and edges were ordered", () => {
    const slotComposition = composition({ compositionId: "comp-slot", layers: [layer({ index: 1 })] });
    const hostA = composition({
      compositionId: "comp-a",
      precompChildren: [
        { layerIndex: 2, layerName: "a2", sourceCompositionId: "comp-slot", enabled: true },
        { layerIndex: 5, layerName: "a5", sourceCompositionId: "comp-slot", enabled: true }
      ]
    });
    const hostB = composition({ compositionId: "comp-b", precompChildren: [{ layerIndex: 3, layerName: "b3", sourceCompositionId: "comp-slot", enabled: true }] });
    const build = (compositions: CompositionFact[]) =>
      buildSlotStructuralFacts({
        slotComposition,
        slotLayerIndex: 1,
        slotLayerName: null,
        compositions,
        layerFactsByCompositionAndIndex: new Map(),
        hostDepth: 1,
        slotIsWholeComposition: true
      });

    const forwards = build([slotComposition, hostA, hostB]);
    const backwards = build([hostB, { ...hostA, precompChildren: [...hostA.precompChildren].reverse() }, slotComposition]);

    expect(backwards).toEqual(forwards);
    expect(computeSlotFingerprint(backwards)).toEqual(computeSlotFingerprint(forwards));
    expect(forwards.hosts.map((host) => `${host.compositionId}:${host.layerIndex}`)).toEqual(["comp-a:2", "comp-a:5", "comp-b:3"]);
  });
});
