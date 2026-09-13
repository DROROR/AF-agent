import { describe, expect, it } from "vitest";
import { buildProjectFacts } from "./build-project-facts.js";
import type { CompositionDetail, CompositionSummary } from "./parse-mcp-shapes.js";
import type { ScannedLayerFact } from "./parse-project-preflight-scan.js";

const summaryA: CompositionSummary = {
  index: 3,
  name: "Comp A",
  widthPx: 1920,
  heightPx: 1080,
  frameRate: 30,
  durationSeconds: 5,
  numLayers: 2
};

const summaryB: CompositionSummary = {
  index: 7,
  name: "Comp B",
  widthPx: 1080,
  heightPx: 1920,
  frameRate: 30,
  durationSeconds: 10,
  numLayers: 0
};

const detailA: CompositionDetail = {
  compId: 42,
  name: "Comp A",
  widthPx: 1920,
  heightPx: 1080,
  frameRate: 30,
  durationSeconds: 5,
  numLayers: 2,
  layers: [
    { index: 1, name: "Text Layer", inPointSeconds: 0, outPointSeconds: 5, nullLayer: false },
    { index: 2, name: "Null Anchor", inPointSeconds: 0, outPointSeconds: 5, nullLayer: true }
  ]
};

describe("buildProjectFacts", () => {
  it("uses comp.id (more stable than project-item index) for compositionId when a detail was fetched", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    expect(facts.compositions[0]?.compositionId).toBe("comp-42");
  });

  it("falls back to the project-item index when the detail fetch failed for that composition", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: null,
      discovered: [summaryB],
      details: [null]
    });
    expect(facts.compositions[0]?.compositionId).toBe("idx-7");
    // No layer facts at all when detail is unavailable - never fabricated.
    expect(facts.compositions[0]?.layers).toEqual([]);
  });

  it("excludes null-object layers from the composition's layers (excluded from placeholder candidates)", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    const layers = facts.compositions[0]?.layers ?? [];
    expect(layers).toHaveLength(1);
    expect(layers[0]?.name).toBe("Text Layer");
  });

  it("always records layerKind as Unknown - the confirmed ae_get_composition shape has no type discriminator, and this never guesses one", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    expect(facts.compositions[0]?.layers[0]?.layerKind).toBe("Unknown");
    expect(facts.compositions[0]?.layers[0]?.footage).toBeNull();
    expect(facts.compositions[0]?.layers[0]?.solidFill).toBeNull();
  });

  it("computes layer duration from outPoint - inPoint", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    expect(facts.compositions[0]?.layers[0]?.startTimeSeconds).toBe(0);
    expect(facts.compositions[0]?.layers[0]?.durationSeconds).toBe(5);
  });

  it("defaults isNestedOnlyReferenced to false and parentCompositionIds to [] - genuinely unconfirmable from this tool set, never guessed from naming", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    expect(facts.compositions[0]?.isNestedOnlyReferenced).toBe(false);
    expect(facts.compositions[0]?.parentCompositionIds).toEqual([]);
  });

  it("preserves discovery order across multiple compositions", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryB, summaryA],
      details: [null, detailA]
    });
    expect(facts.compositions.map((c) => c.name)).toEqual(["Comp B", "Comp A"]);
  });

  it("computes real isNestedOnlyReferenced/parentCompositionIds from precompFacts - client-facing UX redesign, LIVE UX ACCEPTANCE FAILED follow-up", () => {
    const detailAWithPrecomp: CompositionDetail = {
      ...detailA,
      layers: [
        ...(detailA.layers ?? []),
        { index: 3, name: "Nested Comp B Layer", inPointSeconds: 0, outPointSeconds: 5, nullLayer: false }
      ]
    };
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA, summaryB],
      details: [detailAWithPrecomp, null],
      precompFacts: [[{ layerIndex: 3, sourceCompositionId: "idx-7" }], []]
    });
    const compA = facts.compositions.find((c) => c.compositionId === "comp-42");
    const compB = facts.compositions.find((c) => c.compositionId === "idx-7");
    expect(compB?.isNestedOnlyReferenced).toBe(true);
    expect(compB?.parentCompositionIds).toEqual(["comp-42"]);
    expect(compA?.isNestedOnlyReferenced).toBe(false);
    expect(compA?.parentCompositionIds).toEqual([]);
  });

  it("excludes a confirmed precomp-reference layer from the composition's own layers - it is structural, never an editable placeholder candidate", () => {
    const detailAWithPrecomp: CompositionDetail = {
      ...detailA,
      layers: [
        ...(detailA.layers ?? []),
        { index: 3, name: "Nested Comp B Layer", inPointSeconds: 0, outPointSeconds: 5, nullLayer: false }
      ]
    };
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailAWithPrecomp],
      precompFacts: [[{ layerIndex: 3, sourceCompositionId: "idx-7" }]]
    });
    const layerNames = facts.compositions[0]?.layers.map((l) => l.name) ?? [];
    expect(layerNames).toEqual(["Text Layer"]);
    expect(layerNames).not.toContain("Nested Comp B Layer");
  });

  it("a null precompFacts entry for one composition (failed/never attempted) never affects another composition's own real nesting facts", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA, summaryB],
      details: [detailA, null],
      precompFacts: [null, [{ layerIndex: 1, sourceCompositionId: "comp-42" }]]
    });
    const compA = facts.compositions.find((c) => c.compositionId === "comp-42");
    expect(compA?.isNestedOnlyReferenced).toBe(true);
    expect(compA?.parentCompositionIds).toEqual(["idx-7"]);
  });

  it("leaves fonts/footage/missingFootage/pluginReferences honestly empty - not determinable from this tool set", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    expect(facts.requiredFonts).toEqual([]);
    expect(facts.footageReferenced).toEqual([]);
    expect(facts.missingFootage).toEqual([]);
    expect(facts.pluginReferences).toEqual([]);
  });
});

describe("buildProjectFacts - inputs for nested composition traversal (2026-09-13)", () => {
  const detailWithPrecomps: CompositionDetail = {
    ...detailA,
    numLayers: 5,
    layers: [
      ...(detailA.layers ?? []),
      { index: 3, name: "Smartphone_01", inPointSeconds: 0, outPointSeconds: 5, nullLayer: false },
      { index: 4, name: "Smartphone_02", inPointSeconds: 0, outPointSeconds: 5, nullLayer: false },
      { index: 5, name: "Unscanned Layer", inPointSeconds: 0, outPointSeconds: 5, nullLayer: false }
    ]
  };

  it("PRESERVES precomp-reference edges as precompChildren - named by the parent's own layer, in layer-index order", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailWithPrecomps],
      // Deliberately supplied out of order.
      precompFacts: [[
        { layerIndex: 4, sourceCompositionId: "comp-s02" },
        { layerIndex: 3, sourceCompositionId: "comp-s01" }
      ]]
    });

    expect(facts.compositions[0]!.precompChildren).toEqual([
      { layerIndex: 3, layerName: "Smartphone_01", sourceCompositionId: "comp-s01", enabled: null, hasTrackMatte: null },
      { layerIndex: 4, layerName: "Smartphone_02", sourceCompositionId: "comp-s02", enabled: null, hasTrackMatte: null }
    ]);
    // Still excluded from the composition's own placeholder candidates.
    expect(facts.compositions[0]!.layers.map((l) => l.name)).not.toContain("Smartphone_01");
  });

  it("gives a composition with no precomp evidence an empty edge list rather than inventing one", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    expect(facts.compositions[0]!.precompChildren).toEqual([]);
  });

  it("carries AE's own layer.enabled from the project scan, and null - never a guess - when the scan has no entry", () => {
    const scanned: ScannedLayerFact = {
      layerIndex: 1,
      layerName: "Text Layer",
      enabled: false,
      kind: "TextLayer",
      footage: null,
      effects: []
    };
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailWithPrecomps],
      precompFacts: [[{ layerIndex: 3, sourceCompositionId: "comp-s01" }, { layerIndex: 4, sourceCompositionId: "comp-s02" }]],
      layerFactsByCompositionAndIndex: new Map([["comp-42:1", scanned]])
    });

    const layers = facts.compositions[0]!.layers;
    expect(layers.find((l) => l.index === 1)!.enabled).toBe(false);
    expect(layers.find((l) => l.index === 5)!.enabled).toBeNull();
  });

  it("carries the precomp-reference layer's OWN enabled flag, so a hidden precomp is never descended into", () => {
    const hiddenPrecomp: ScannedLayerFact = { layerIndex: 3, layerName: "Smartphone_01", enabled: false, kind: "AVLayer", footage: null, effects: [] };
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailWithPrecomps],
      precompFacts: [[{ layerIndex: 3, sourceCompositionId: "comp-s01" }, { layerIndex: 4, sourceCompositionId: "comp-s02" }]],
      layerFactsByCompositionAndIndex: new Map([["comp-42:3", hiddenPrecomp]])
    });

    expect(facts.compositions[0]!.precompChildren.map((c) => c.enabled)).toEqual([false, null]);
  });

  it("carries the scan's track-matte and guide facts for layers and precomp references, and null when the scan did not read them", () => {
    const detail = (overrides: Partial<NonNullable<ScannedLayerFact["detail"]>>): NonNullable<ScannedLayerFact["detail"]> => ({
      isTrackMatte: null,
      hasTrackMatte: null,
      trackMatteType: null,
      trackMatteLayerIndex: null,
      guideLayer: null,
      adjustmentLayer: null,
      nullLayer: null,
      shy: null,
      threeDLayer: null,
      blendingMode: null,
      preserveTransparency: null,
      parentLayerIndex: null,
      sourceName: null,
      sourceCompositionId: null,
      inPointSeconds: null,
      outPointSeconds: null,
      opacityAtInPoint: null,
      opacityKeyframeCount: null,
      textPreview: null,
      ...overrides
    });
    const mattedLayer: ScannedLayerFact = {
      layerIndex: 1,
      layerName: "Beauty_Pass.mov",
      enabled: true,
      kind: "AVLayer",
      footage: null,
      effects: [],
      detail: detail({ hasTrackMatte: true, trackMatteType: "LUMA", trackMatteLayerIndex: 2, guideLayer: false })
    };
    const mattedPrecomp: ScannedLayerFact = { layerIndex: 3, layerName: "Placeholder_01", enabled: true, kind: "AVLayer", footage: null, effects: [], detail: detail({ hasTrackMatte: true }) };
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailWithPrecomps],
      precompFacts: [[{ layerIndex: 3, sourceCompositionId: "comp-s01" }, { layerIndex: 4, sourceCompositionId: "comp-s02" }]],
      layerFactsByCompositionAndIndex: new Map([
        ["comp-42:1", mattedLayer],
        ["comp-42:3", mattedPrecomp]
      ])
    });

    const layers = facts.compositions[0]!.layers;
    expect(layers.find((l) => l.index === 1)).toMatchObject({ trackMatte: { isTrackMatte: null, hasTrackMatte: true, matteLayerIndex: 2 }, guideLayer: false });
    expect(layers.find((l) => l.index === 5)).toMatchObject({ trackMatte: null, guideLayer: null });
    expect(facts.compositions[0]!.precompChildren.map((c) => c.hasTrackMatte)).toEqual([true, null]);
  });
});

