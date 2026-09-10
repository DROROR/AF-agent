import { describe, expect, it } from "vitest";
import type { HostLayerRecord, LayerDetailFact, LayerEvidence, PlaceholderMapping, SceneEvidenceResponse } from "@dyo/schemas";
import {
  calculatePreviewTiming,
  computeChainVisibleRanges,
  derivePreviewTimingChainTargets,
  deriveManifestContainmentPath,
  distinctChainEntryCompositionIds,
  findHostLayers,
  opacityVisibleIntervals,
  resolveManifestPathHops,
  resolvePreviewTimingChains,
  type ChainHop,
  type ChainHopSlot,
  type HostLayerFetcher,
  type LabeledChain,
  type LayerWindow,
  type ManifestCompositionRef,
  type OpacityFact
} from "./preview-timing";

function window(overrides: Partial<LayerWindow> = {}): LayerWindow {
  return { layerIndex: 1, enabled: true, inPointSeconds: 0, outPointSeconds: 5, startTimeSeconds: 0, ...overrides };
}

function hop(overrides: Partial<ChainHop> = {}): ChainHop {
  return { compositionId: "comp-x", window: window(), stretchPercent: 100, timeRemapEnabled: false, opacity: null, ...overrides };
}

/** Wraps a sequence of single hops into single-candidate slots - the overwhelmingly common shape, and what every pre-2026-09-10 test exercised. */
function slots(hops: readonly ChainHop[]): ChainHopSlot[] {
  return hops.map((h) => [h]);
}

const NOW_ISO = "2026-09-10T00:00:00.000Z";
function mapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
  return {
    id: "mapping-1",
    manifestPlaceholderId: null,
    placeholderName: null,
    placeholderClassification: { value: "text", source: "HUMAN", evidence: [] },
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
    mappingSource: "HUMAN",
    confidence: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides
  };
}

function layerEvidence(overrides: Partial<LayerEvidence> = {}): LayerEvidence {
  return {
    layerIndex: 1,
    name: "Layer",
    enabled: true,
    nullLayer: false,
    threeDLayer: false,
    inPointSeconds: 0,
    outPointSeconds: 5,
    startTimeSeconds: 0,
    parentLayerName: null,
    opacityPercent: 100,
    layerType: null,
    sourceItemName: null,
    sourceWidthPx: null,
    sourceHeightPx: null,
    sourceDurationSeconds: null,
    textValue: null,
    nestedCompositionId: null,
    evidenceSource: "AE_GET_LAYER",
    ...overrides
  };
}

function layerDetail(overrides: Partial<LayerDetailFact> = {}): LayerDetailFact {
  return {
    layerIndex: 1,
    layerName: "Layer",
    layerType: "OTHER",
    sourceText: null,
    sourceCompositionId: null,
    stretchPercent: 100,
    timeRemapEnabled: false,
    opacityStatic: null,
    opacityKeyframes: null,
    ...overrides
  };
}

function hostLayerRecord(overrides: Partial<HostLayerRecord> = {}): HostLayerRecord {
  return {
    layerIndex: 1,
    layerName: "Host Layer",
    enabled: true,
    inPointSeconds: 0,
    outPointSeconds: 5,
    startTimeSeconds: 0,
    sourceCompositionId: "comp-child",
    stretchPercent: 100,
    timeRemapEnabled: false,
    opacityStatic: null,
    opacityKeyframes: null,
    ...overrides
  };
}

function sceneEvidence(overrides: Partial<SceneEvidenceResponse> = {}): SceneEvidenceResponse {
  return {
    verifiedSourceProjectSha256: "a".repeat(64),
    manifestCompositionId: "comp-x",
    aeProjectItemIndex: 1,
    compositionName: "Comp X",
    layers: [],
    preview: null,
    previewFailureReason: null,
    layerDetails: [],
    layerDetailsFailureReason: null,
    hostLayerRecords: null,
    hostLayerRecordsFailureReason: null,
    capturedAt: NOW_ISO,
    ...overrides
  };
}

describe("derivePreviewTimingChainTargets", () => {
  it("derives the FULL real-incident chain (2026-09-10 extension) - all four logo hops and both Hebrew hops, no outer-discovery prepend (that is now a separate adaptive mechanism)", () => {
    const result = derivePreviewTimingChainTargets([
      mapping({
        id: "logo",
        placeholderName: "App Logo",
        humanNestedTarget: [
          { compositionId: "comp-1", layerIndex: 3 },
          { compositionId: "comp-1635", layerIndex: 1 },
          { compositionId: "comp-1044", layerIndex: 1 },
          { compositionId: "comp-1113", layerIndex: 1 }
        ]
      }),
      mapping({
        id: "hebrew",
        placeholderName: "Hebrew Branding",
        humanNestedTarget: [
          { compositionId: "comp-1", layerIndex: 3 },
          { compositionId: "comp-1635", layerIndex: 4 }
        ]
      })
    ]);

    expect(result).toEqual([
      { compositionId: "comp-1", layerIndices: [3] },
      { compositionId: "comp-1635", layerIndices: [1, 4] },
      { compositionId: "comp-1044", layerIndices: [1] },
      { compositionId: "comp-1113", layerIndices: [1] }
    ]);
  });

  it("returns an empty array when no mapping has a nested target", () => {
    expect(derivePreviewTimingChainTargets([mapping({ humanNestedTarget: null })])).toEqual([]);
  });
});

describe("distinctChainEntryCompositionIds", () => {
  it("returns the distinct first-hop compositionIds that differ from the outermost composition - real incident shape (comp-1 differs from comp-210)", () => {
    const result = distinctChainEntryCompositionIds(
      [
        mapping({ id: "logo", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }, { compositionId: "comp-1635", layerIndex: 1 }] }),
        mapping({ id: "hebrew", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }, { compositionId: "comp-1635", layerIndex: 4 }] })
      ],
      "comp-210"
    );
    expect(result).toEqual(["comp-1"]);
  });

  it("excludes a first hop that already equals the outermost composition - nothing to discover there", () => {
    const result = distinctChainEntryCompositionIds([mapping({ humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] })], "comp-1");
    expect(result).toEqual([]);
  });

  it("returns an empty array when no mapping has a nested target", () => {
    expect(distinctChainEntryCompositionIds([mapping({ humanNestedTarget: null })], "comp-210")).toEqual([]);
  });
});

function manifestComp(compositionId: string, parentCompositionIds: string[]): ManifestCompositionRef {
  return { compositionId, parentCompositionIds };
}

describe("deriveManifestContainmentPath", () => {
  it("real 2026-09-10 incident (session a7fee3d9): resolves the genuine chain purely from manifest parentCompositionIds - comp-210 -> comp-1, entirely without any live dispatch", () => {
    const compositions = [manifestComp("comp-210", []), manifestComp("comp-1", ["comp-210"]), manifestComp("comp-1635", ["comp-1"])];
    const result = deriveManifestContainmentPath(compositions, "comp-210", "comp-1");
    expect(result).toEqual({ ok: true, path: ["comp-210", "comp-1"] });
  });

  it("resolves a real multi-hop path through an intermediate wrapper composition", () => {
    const compositions = [manifestComp("comp-210", []), manifestComp("comp-999", ["comp-210"]), manifestComp("comp-1", ["comp-999"])];
    const result = deriveManifestContainmentPath(compositions, "comp-210", "comp-1");
    expect(result).toEqual({ ok: true, path: ["comp-210", "comp-999", "comp-1"] });
  });

  it("returns a single-element path with root===target - nothing to discover", () => {
    expect(deriveManifestContainmentPath([manifestComp("comp-1", [])], "comp-1", "comp-1")).toEqual({ ok: true, path: ["comp-1"] });
  });

  it("finds the SHORTEST real path breadth-first when multiple real manifest paths of different depth exist", () => {
    const compositions = [
      manifestComp("comp-210", []),
      manifestComp("comp-A", ["comp-210"]),
      manifestComp("comp-B", ["comp-210"]),
      manifestComp("comp-C", ["comp-B"]),
      manifestComp("comp-1", ["comp-A", "comp-C"])
    ];
    const result = deriveManifestContainmentPath(compositions, "comp-210", "comp-1");
    expect(result).toEqual({ ok: true, path: ["comp-210", "comp-A", "comp-1"] });
  });

  it("fails clearly (never guesses, never falls back to a live scan) when no real manifest-recorded path connects the two composition ids", () => {
    const compositions = [manifestComp("comp-210", []), manifestComp("comp-999", [])];
    const result = deriveManifestContainmentPath(compositions, "comp-210", "comp-999");
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("no real containment path") });
  });

  it("never revisits the same composition twice, even when reachable via a composition referenced from multiple parents", () => {
    const compositions = [
      manifestComp("comp-210", []),
      manifestComp("comp-A", ["comp-210"]),
      manifestComp("comp-B", ["comp-210"]),
      manifestComp("comp-shared", ["comp-A", "comp-B"]),
      manifestComp("comp-1", ["comp-shared"])
    ];
    const result = deriveManifestContainmentPath(compositions, "comp-210", "comp-1");
    expect(result).toEqual({ ok: true, path: ["comp-210", "comp-A", "comp-shared", "comp-1"] });
  });
});

/**
 * A fake in-memory host-layer-lookup graph (live QA, 2026-09-10 targeted
 * host-layer lookup extension) - `graph[parentCompositionId]` lists that
 * parent's own real host layers for the SPECIFIC child it was asked about
 * (mirrors the real Worker's `buildFindHostLayersScript` - a genuine,
 * targeted per-edge lookup, never a broad scan of the whole parent).
 * `calls` records every real fetch (parent + child). `failureFor`, when
 * set, makes the fetch for that one parent compositionId report a scan
 * FAILURE (hostLayerRecords: null) rather than a real result - simulating
 * the exact real 2026-09-10 incident shape (a timeout).
 */
function fakeHostLayerFetcher(
  graph: Record<string, HostLayerRecord[]>,
  options: { calls?: { parentCompositionId: string; childCompositionId: string }[]; failureFor?: string } = {}
): HostLayerFetcher {
  return async (parentCompositionId, childCompositionId) => {
    options.calls?.push({ parentCompositionId, childCompositionId });
    if (parentCompositionId === options.failureFor) {
      return {
        ok: true,
        response: sceneEvidence({
          manifestCompositionId: parentCompositionId,
          hostLayerRecords: null,
          hostLayerRecordsFailureReason: "ae_run_jsx failed: MCP error -32001: Request timed out"
        })
      };
    }
    const matches = (graph[parentCompositionId] ?? []).filter((record) => record.sourceCompositionId === childCompositionId);
    return { ok: true, response: sceneEvidence({ manifestCompositionId: parentCompositionId, hostLayerRecords: matches }) };
  };
}

describe("findHostLayers", () => {
  it("finds every real matching host layer for the known target composition - single instance", async () => {
    const fetcher = fakeHostLayerFetcher({ "comp-210": [hostLayerRecord({ layerIndex: 9, sourceCompositionId: "comp-1" })] });
    const result = await findHostLayers("comp-210", "comp-1", fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches.map((m) => m.layerIndex)).toEqual([9]);
  });

  it("real 2026-09-10 targeted host-layer lookup incident: multiple placements of the same child composition are ALL reported, never silently narrowed to the first", async () => {
    const fetcher = fakeHostLayerFetcher({
      "comp-210": [
        hostLayerRecord({ layerIndex: 2, sourceCompositionId: "comp-1" }),
        hostLayerRecord({ layerIndex: 4, sourceCompositionId: "comp-1" }),
        hostLayerRecord({ layerIndex: 6, sourceCompositionId: "comp-other" })
      ]
    });
    const result = await findHostLayers("comp-210", "comp-1", fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches.map((m) => m.layerIndex)).toEqual([2, 4]);
  });

  it("SCAN FAILED != EMPTY COMPOSITION - a null hostLayerRecords (real timeout shape) is reported as a clear evidence failure, never silently treated as \"not found\"", async () => {
    const fetcher = fakeHostLayerFetcher({}, { failureFor: "comp-210" });
    const result = await findHostLayers("comp-210", "comp-1", fetcher);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("did not complete");
    expect(result.reason).toContain("MCP error -32001");
    // The message may explain that it refuses to draw this conclusion,
    // but must never actually CONCLUDE "does not appear" / "never found" -
    // that conclusion is reserved for a scan that genuinely succeeded.
    expect(result.reason).not.toMatch(/does not appear as a real nested composition|never found/i);
  });

  it("a scan that genuinely SUCCEEDS with zero real matches despite the manifest claiming the edge fails clearly with the explicit MANIFEST_EDGE_NOT_FOUND_IN_AE marker - distinct from a failed scan", async () => {
    const fetcher = fakeHostLayerFetcher({ "comp-210": [] });
    const result = await findHostLayers("comp-210", "comp-1", fetcher);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("MANIFEST_EDGE_NOT_FOUND_IN_AE");
  });

  it("a scan that succeeds but simply doesn't contain the target among its real matches also fails with MANIFEST_EDGE_NOT_FOUND_IN_AE, distinct from a scan failure", async () => {
    const fetcher = fakeHostLayerFetcher({ "comp-210": [hostLayerRecord({ layerIndex: 1, sourceCompositionId: "comp-other" })] });
    const result = await findHostLayers("comp-210", "comp-1", fetcher);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("MANIFEST_EDGE_NOT_FOUND_IN_AE");
  });

  it("propagates a real fetch failure (e.g. a Worker/job dispatch error) as its own message", async () => {
    const fetcher: HostLayerFetcher = async () => ({ ok: false, message: "simulated Worker offline" });
    const result = await findHostLayers("comp-210", "comp-1", fetcher);
    expect(result).toEqual({ ok: false, reason: "simulated Worker offline" });
  });

  it("passes both the parent and child compositionId through to the fetcher - a genuine targeted, per-edge lookup", async () => {
    const calls: { parentCompositionId: string; childCompositionId: string }[] = [];
    const fetcher = fakeHostLayerFetcher({ "comp-210": [hostLayerRecord({ layerIndex: 1, sourceCompositionId: "comp-1" })] }, { calls });
    await findHostLayers("comp-210", "comp-1", fetcher);
    expect(calls).toEqual([{ parentCompositionId: "comp-210", childCompositionId: "comp-1" }]);
  });
});

describe("resolveManifestPathHops", () => {
  it("real 2026-09-10 incident (session a7fee3d9), end to end: resolves comp-210 -> comp-1 using the manifest for the SEQUENCE and exactly ONE targeted live lookup for the real host layer - never a broad scan of every sibling composition", async () => {
    const compositions = [manifestComp("comp-210", []), manifestComp("comp-1", ["comp-210"])];
    const calls: { parentCompositionId: string; childCompositionId: string }[] = [];
    const fetcher = fakeHostLayerFetcher({ "comp-210": [hostLayerRecord({ layerIndex: 9, sourceCompositionId: "comp-1" })] }, { calls });

    const result = await resolveManifestPathHops(compositions, "comp-210", "comp-1", fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hopSlots).toHaveLength(1);
    expect(result.hopSlots[0]!.map((h) => [h.compositionId, h.window.layerIndex])).toEqual([["comp-210", 9]]);
    expect(calls).toEqual([{ parentCompositionId: "comp-210", childCompositionId: "comp-1" }]);
  });

  it("multiple real placements of the same child at one hop produce a multi-candidate slot, never narrowed to one", async () => {
    const compositions = [manifestComp("comp-210", []), manifestComp("comp-1", ["comp-210"])];
    const fetcher = fakeHostLayerFetcher({
      "comp-210": [hostLayerRecord({ layerIndex: 2, sourceCompositionId: "comp-1" }), hostLayerRecord({ layerIndex: 4, sourceCompositionId: "comp-1" })]
    });

    const result = await resolveManifestPathHops(compositions, "comp-210", "comp-1", fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hopSlots).toHaveLength(1);
    expect(result.hopSlots[0]!.map((h) => h.window.layerIndex)).toEqual([2, 4]);
  });

  it("resolves a real multi-hop manifest path with one targeted lookup PER hop", async () => {
    const compositions = [manifestComp("comp-210", []), manifestComp("comp-999", ["comp-210"]), manifestComp("comp-1", ["comp-999"])];
    const calls: { parentCompositionId: string; childCompositionId: string }[] = [];
    const fetcher = fakeHostLayerFetcher(
      { "comp-210": [hostLayerRecord({ layerIndex: 2, sourceCompositionId: "comp-999" })], "comp-999": [hostLayerRecord({ layerIndex: 4, sourceCompositionId: "comp-1" })] },
      { calls }
    );

    const result = await resolveManifestPathHops(compositions, "comp-210", "comp-1", fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hopSlots.map((slot) => slot.map((h) => [h.compositionId, h.window.layerIndex]))).toEqual([
      [["comp-210", 2]],
      [["comp-999", 4]]
    ]);
    expect(calls).toEqual([
      { parentCompositionId: "comp-210", childCompositionId: "comp-999" },
      { parentCompositionId: "comp-999", childCompositionId: "comp-1" }
    ]);
  });

  it("returns zero hop slots and zero fetches when root already IS the target", async () => {
    const calls: { parentCompositionId: string; childCompositionId: string }[] = [];
    const fetcher = fakeHostLayerFetcher({}, { calls });
    const result = await resolveManifestPathHops([manifestComp("comp-1", [])], "comp-1", "comp-1", fetcher);
    expect(result).toEqual({ ok: true, hopSlots: [] });
    expect(calls).toEqual([]);
  });

  it("fails clearly, with zero live dispatches, when the manifest itself has no path - never falls back to a live scan", async () => {
    const calls: { parentCompositionId: string; childCompositionId: string }[] = [];
    const fetcher = fakeHostLayerFetcher({}, { calls });
    const result = await resolveManifestPathHops([manifestComp("comp-210", []), manifestComp("comp-999", [])], "comp-210", "comp-999", fetcher);
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("a real Worker scan timeout on one hop propagates as a clear evidence-failure reason, never a false \"not reachable\" (the exact comp-210 -> comp-1 incident)", async () => {
    const compositions = [manifestComp("comp-210", []), manifestComp("comp-1", ["comp-210"])];
    const fetcher = fakeHostLayerFetcher({}, { failureFor: "comp-210" });
    const result = await resolveManifestPathHops(compositions, "comp-210", "comp-1", fetcher);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("did not complete");
    expect(result.reason).not.toMatch(/not reachable|never found/i);
  });

  it("a manifest edge with zero real AE matches propagates the explicit MANIFEST_EDGE_NOT_FOUND_IN_AE marker", async () => {
    const compositions = [manifestComp("comp-210", []), manifestComp("comp-1", ["comp-210"])];
    const fetcher = fakeHostLayerFetcher({ "comp-210": [] });
    const result = await resolveManifestPathHops(compositions, "comp-210", "comp-1", fetcher);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("MANIFEST_EDGE_NOT_FOUND_IN_AE");
  });
});

describe("resolvePreviewTimingChains", () => {
  it("resolves a discovered outer path (real graph-search result) prepended to the human-authored chain - never a hardcoded/guessed layer index", () => {
    const mappings = [mapping({ id: "logo", placeholderName: "Logo", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] })];
    const discoveredOuterPaths = new Map<string, ChainHopSlot[]>([
      ["comp-1", [[hop({ compositionId: "comp-210", window: window({ layerIndex: 7 }) })]]]
    ]);
    const resultsByCompositionId = new Map<string, SceneEvidenceResponse>([
      ["comp-1", sceneEvidence({ manifestCompositionId: "comp-1", layers: [layerEvidence({ layerIndex: 3, inPointSeconds: 1, outPointSeconds: 4 })], layerDetails: [layerDetail({ layerIndex: 3 })] })]
    ]);

    const result = resolvePreviewTimingChains(mappings, "comp-210", discoveredOuterPaths, resultsByCompositionId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.hopSlots.map((slot) => slot.map((h) => [h.compositionId, h.window.layerIndex]))).toEqual([
      [["comp-210", 7]],
      [["comp-1", 3]]
    ]);
  });

  it("a multi-candidate discovered slot is threaded through untouched - never collapsed to one candidate", () => {
    const mappings = [mapping({ id: "logo", placeholderName: "Logo", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] })];
    const discoveredOuterPaths = new Map<string, ChainHopSlot[]>([
      [
        "comp-1",
        [[hop({ compositionId: "comp-210", window: window({ layerIndex: 2 }) }), hop({ compositionId: "comp-210", window: window({ layerIndex: 4 }) })]]
      ]
    ]);
    const resultsByCompositionId = new Map<string, SceneEvidenceResponse>([
      ["comp-1", sceneEvidence({ manifestCompositionId: "comp-1", layers: [layerEvidence({ layerIndex: 3, inPointSeconds: 1, outPointSeconds: 4 })], layerDetails: [layerDetail({ layerIndex: 3 })] })]
    ]);

    const result = resolvePreviewTimingChains(mappings, "comp-210", discoveredOuterPaths, resultsByCompositionId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chains[0]!.hopSlots[0]!.map((h) => h.window.layerIndex)).toEqual([2, 4]);
  });

  it("fails clearly (never guesses) when a chain's own first hop needed discovery but none was ever recorded for it", () => {
    const mappings = [mapping({ id: "logo", placeholderName: "Logo", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] })];
    const result = resolvePreviewTimingChains(mappings, "comp-210", new Map(), new Map());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("never discovered");
  });

  it("fails clearly when real timing evidence for a required hop is missing from its own composition's collected result", () => {
    const mappings = [mapping({ id: "logo", placeholderName: "Logo", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] })];
    const resultsByCompositionId = new Map<string, SceneEvidenceResponse>([["comp-1", sceneEvidence({ manifestCompositionId: "comp-1", layers: [] })]]);
    const result = resolvePreviewTimingChains(mappings, "comp-1", new Map(), resultsByCompositionId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Missing real timing evidence");
  });

  it("needs no discovered path at all when the chain's own first hop already equals the outermost composition", () => {
    const mappings = [mapping({ id: "logo", placeholderName: "Logo", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }] })];
    const resultsByCompositionId = new Map<string, SceneEvidenceResponse>([
      ["comp-1", sceneEvidence({ manifestCompositionId: "comp-1", layers: [layerEvidence({ layerIndex: 3 })] })]
    ]);
    const result = resolvePreviewTimingChains(mappings, "comp-1", new Map(), resultsByCompositionId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chains[0]!.hopSlots).toHaveLength(1);
  });
});

describe("opacityVisibleIntervals", () => {
  it("treats null opacity (property could not be read) as fully visible over the whole window - never refuses merely because a read failed", () => {
    expect(opacityVisibleIntervals(null, 0, 5)).toEqual([[0, 5]]);
  });

  it("real 2026-09-10 incident shape: a confirmed STATIC opacity of 0 excludes the whole window entirely", () => {
    const opacity: OpacityFact = { staticPercent: 0, keyframes: null };
    expect(opacityVisibleIntervals(opacity, 0.96763430096763, 5.63897230563897)).toEqual([]);
  });

  it("a confirmed STATIC opacity greater than 0 is fully visible over the whole window", () => {
    const opacity: OpacityFact = { staticPercent: 100, keyframes: null };
    expect(opacityVisibleIntervals(opacity, 0, 5)).toEqual([[0, 5]]);
  });

  it("animated opacity REVEAL (0 -> 100) - only the real sub-interval from the crossing keyframe onward is visible", () => {
    const opacity: OpacityFact = { staticPercent: null, keyframes: [{ timeSeconds: 1, valuePercent: 0 }, { timeSeconds: 2, valuePercent: 100 }] };
    expect(opacityVisibleIntervals(opacity, 0, 5)).toEqual([[1, 5]]);
  });

  it("animated opacity FADE-OUT (100 -> 0) - only the real sub-interval before the crossing keyframe is visible", () => {
    const opacity: OpacityFact = { staticPercent: null, keyframes: [{ timeSeconds: 2, valuePercent: 100 }, { timeSeconds: 4, valuePercent: 0 }] };
    expect(opacityVisibleIntervals(opacity, 0, 5)).toEqual([[0, 4]]);
  });

  it("a fade-in-then-fade-out (0 -> 100 -> 0) produces exactly one merged visible interval spanning both non-zero segments", () => {
    const opacity: OpacityFact = {
      staticPercent: null,
      keyframes: [
        { timeSeconds: 1, valuePercent: 0 },
        { timeSeconds: 2.5, valuePercent: 100 },
        { timeSeconds: 4, valuePercent: 0 }
      ]
    };
    expect(opacityVisibleIntervals(opacity, 0, 5)).toEqual([[1, 4]]);
  });

  it("a segment between two zero-value keyframes is excluded even when the window includes values before/after", () => {
    const opacity: OpacityFact = {
      staticPercent: null,
      keyframes: [
        { timeSeconds: 1, valuePercent: 0 },
        { timeSeconds: 2, valuePercent: 0 },
        { timeSeconds: 3, valuePercent: 100 }
      ]
    };
    expect(opacityVisibleIntervals(opacity, 0, 5)).toEqual([[2, 5]]);
  });

  it("holds the first keyframe's own value flat before it, and the last keyframe's own value flat after it (AE's real default behavior)", () => {
    const opacity: OpacityFact = { staticPercent: null, keyframes: [{ timeSeconds: 2, valuePercent: 100 }, { timeSeconds: 3, valuePercent: 100 }] };
    expect(opacityVisibleIntervals(opacity, 0, 5)).toEqual([[0, 5]]);
  });
});

describe("computeChainVisibleRanges", () => {
  it("single hop (original 2026-09-09 behavior preserved) - maps a leaf's own in/out points into the wrapper's own timeline at 100% stretch", () => {
    const result = computeChainVisibleRanges(
      slots([
        hop({ compositionId: "comp-1", window: window({ layerIndex: 3, inPointSeconds: 0, outPointSeconds: 7, startTimeSeconds: 0 }) }),
        hop({ compositionId: "comp-1635", window: window({ layerIndex: 1, inPointSeconds: 2, outPointSeconds: 6 }) })
      ])
    );
    expect(result).toEqual({ ok: true, ranges: [[2, 6]] });
  });

  it("3-hop chain composes the transform twice, outward from the leaf", () => {
    const result = computeChainVisibleRanges(
      slots([
        hop({ compositionId: "comp-A", window: window({ inPointSeconds: 0, outPointSeconds: 20, startTimeSeconds: 0 }) }),
        hop({ compositionId: "comp-B", window: window({ inPointSeconds: 0, outPointSeconds: 10, startTimeSeconds: 5 }) }),
        hop({ compositionId: "comp-C", window: window({ inPointSeconds: 1, outPointSeconds: 3 }) })
      ])
    );
    // leaf [1,3] -> comp-B: startTime 5 + [1,3] = [6,8], clamped to [0,10] -> [6,8]
    // -> comp-A: startTime 0 + [6,8] = [6,8], clamped to [0,20] -> [6,8]
    expect(result).toEqual({ ok: true, ranges: [[6, 8]] });
  });

  it("real 2026-09-10 incident 4-hop logo chain (!Render outer-discovery -> Scene 1 -> Pre-comp 3 -> App Emblem, real evidence values) - reproduces the true logo range, not the App-Emblem-as-stand-in approximation the old 2-hop version used", () => {
    const result = computeChainVisibleRanges(
      slots([
        // !Render's own layer hosting Scene 1 - assumed identity in the old version; now real, measured evidence.
        hop({ compositionId: "comp-210", window: window({ inPointSeconds: 0, outPointSeconds: 45.045045045045, startTimeSeconds: 0 }) }),
        // Scene 1's own layer 3 hosting Pre-comp 3 - the real evidence from job 16c2c2f7.
        hop({ compositionId: "comp-1", window: window({ layerIndex: 3, inPointSeconds: 1.63496830163497, outPointSeconds: 8.64197530864197, startTimeSeconds: 1.63496830163497 }) }),
        // Pre-comp 3's own layer 1, App Emblem - the real evidence from job dd608d73.
        hop({ compositionId: "comp-1635", window: window({ layerIndex: 1, inPointSeconds: 0, outPointSeconds: 10.01001001001, startTimeSeconds: 0 }) })
      ])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // App Emblem [0,10.01] * 100% + startTime 1.635 = [1.635, 11.645], clamped to Scene 1 layer's own [1.635, 8.642] -> [1.635, 8.642]
    // then through !Render's own identity layer -> unchanged.
    expect(result.ranges[0]![0]).toBeCloseTo(1.63496830163497, 10);
    expect(result.ranges[0]![1]).toBeCloseTo(8.64197530864197, 10);
  });

  it("stretch propagates correctly across MULTIPLE hops, not just the outermost one", () => {
    const result = computeChainVisibleRanges(
      slots([
        hop({ compositionId: "comp-A", window: window({ inPointSeconds: 0, outPointSeconds: 100, startTimeSeconds: 0 }) }),
        hop({ compositionId: "comp-B", stretchPercent: 50, window: window({ inPointSeconds: 0, outPointSeconds: 100, startTimeSeconds: 0 }) }),
        hop({ compositionId: "comp-C", stretchPercent: 200, window: window({ inPointSeconds: 0, outPointSeconds: 20, startTimeSeconds: 0 }) })
      ])
    );
    // leaf [0,20] (comp-C is the leaf - its own stretch doesn't apply to itself)
    // -> through comp-B (stretch 50%): startTime 0 + [0,20]*0.5 = [0,10]
    // -> through comp-A (stretch: default 100%): startTime 0 + [0,10]*1.0 = [0,10], clamped to [0,100] -> [0,10]
    expect(result).toEqual({ ok: true, ranges: [[0, 10]] });
  });

  it("real incident fix: a leaf with confirmed static opacity 0 (the real Hebrew text layer shape) is excluded entirely - never treated as visible merely because it's inside its own inPoint/outPoint window", () => {
    const result = computeChainVisibleRanges(
      slots([
        hop({ compositionId: "comp-1", window: window({ layerIndex: 3, inPointSeconds: 1.63496830163497, outPointSeconds: 8.64197530864197, startTimeSeconds: 1.63496830163497 }) }),
        hop({
          compositionId: "comp-1635",
          window: window({ layerIndex: 4, inPointSeconds: 0.96763430096763, outPointSeconds: 5.63897230563897, startTimeSeconds: -2.53586920253587 }),
          opacity: { staticPercent: 0, keyframes: null }
        })
      ])
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("confirmed opacity 0");
  });

  it("an animated opacity reveal (held at 0, then ramping up) at the leaf intersects correctly with the wrapper's own mapped window", () => {
    const result = computeChainVisibleRanges(
      slots([
        hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 10, startTimeSeconds: 0 }) }),
        hop({
          compositionId: "comp-2",
          window: window({ inPointSeconds: 0, outPointSeconds: 10 }),
          opacity: { staticPercent: null, keyframes: [{ timeSeconds: 0, valuePercent: 0 }, { timeSeconds: 1, valuePercent: 0 }, { timeSeconds: 3, valuePercent: 100 }] }
        })
      ])
    );
    // [0,1] held at 0 (both endpoints 0) - excluded. [1,3] ramps 0->100 - included (only one endpoint is 0). Held at 100 after t=3.
    expect(result).toEqual({ ok: true, ranges: [[1, 10]] });
  });

  it("a wrapper's OWN opacity (not just the leaf's) also gates visibility", () => {
    const result = computeChainVisibleRanges(
      slots([
        hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 10 }), opacity: { staticPercent: 0, keyframes: null } }),
        hop({ compositionId: "comp-2", window: window({ inPointSeconds: 0, outPointSeconds: 10 }) })
      ])
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Wrapper layer");
  });

  it("refuses when ANY hop (not only the outermost) has time remapping confirmed enabled - fails clearly instead of guessing", () => {
    const result = computeChainVisibleRanges(
      slots([
        hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 10 }) }),
        hop({ compositionId: "comp-2", timeRemapEnabled: true, window: window({ inPointSeconds: 0, outPointSeconds: 10 }) }),
        hop({ compositionId: "comp-3", window: window({ inPointSeconds: 0, outPointSeconds: 5 }) })
      ])
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("time remapping");
  });

  it("refuses when the leaf itself is disabled", () => {
    const result = computeChainVisibleRanges(slots([hop({ window: window({ enabled: false }) })]));
    expect(result.ok).toBe(false);
  });

  it("refuses when a MIDDLE hop (not the outermost, not the leaf) is disabled", () => {
    const result = computeChainVisibleRanges(
      slots([
        hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 10 }) }),
        hop({ compositionId: "comp-2", window: window({ enabled: false, inPointSeconds: 0, outPointSeconds: 10 }) }),
        hop({ compositionId: "comp-3", window: window({ inPointSeconds: 0, outPointSeconds: 5 }) })
      ])
    );
    expect(result.ok).toBe(false);
  });

  it("refuses on an empty chain", () => {
    expect(computeChainVisibleRanges([])).toEqual({ ok: false, reason: expect.stringContaining("Empty chain") });
  });

  it("refuses when a hop's own mapped window never overlaps its wrapper's visible window", () => {
    const result = computeChainVisibleRanges(
      slots([
        hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 2 }) }),
        hop({ compositionId: "comp-2", window: window({ inPointSeconds: 10, outPointSeconds: 15 }) })
      ])
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Never overlaps");
  });

  it("defaults a null stretchPercent to 100 (AE's own default) at any hop, never refusing merely because the property read failed to null", () => {
    const result = computeChainVisibleRanges(
      slots([
        hop({ compositionId: "comp-1", stretchPercent: null, window: window({ inPointSeconds: 0, outPointSeconds: 10 }) }),
        hop({ compositionId: "comp-2", window: window({ inPointSeconds: 2, outPointSeconds: 6 }) })
      ])
    );
    expect(result).toEqual({ ok: true, ranges: [[2, 6]] });
  });

  it("MULTIPLE INSTANCES (live QA, 2026-09-10 targeted host-layer lookup extension): a slot with two valid candidate host layers produces the UNION of both their ranges, not just one", () => {
    const result = computeChainVisibleRanges([
      [
        hop({ compositionId: "comp-210", window: window({ startTimeSeconds: 0, inPointSeconds: 0, outPointSeconds: 100 }) }),
        hop({ compositionId: "comp-210", window: window({ startTimeSeconds: 20, inPointSeconds: 20, outPointSeconds: 100 }) })
      ],
      [hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 5 }) })]
    ]);
    // leaf [0,5] -> candidate A: startTime 0 + [0,5] = [0,5], clamped [0,100] -> [0,5]
    // -> candidate B: startTime 20 + [0,5] = [20,25], clamped [20,100] -> [20,25]
    // union: [[0,5],[20,25]]
    expect(result).toEqual({ ok: true, ranges: [[0, 5], [20, 25]] });
  });

  it("a slot with one valid and one invalid candidate still succeeds using only the valid candidate's range - never refuses merely because ONE instance is unusable", () => {
    const result = computeChainVisibleRanges([
      [
        hop({ compositionId: "comp-210", window: window({ startTimeSeconds: 0, inPointSeconds: 0, outPointSeconds: 100 }) }),
        hop({ compositionId: "comp-210", window: window({ enabled: false, startTimeSeconds: 20, inPointSeconds: 20, outPointSeconds: 100 }) })
      ],
      [hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 5 }) })]
    ]);
    expect(result).toEqual({ ok: true, ranges: [[0, 5]] });
  });

  it("refuses only when EVERY candidate at a slot fails, and reports every real reason", () => {
    const result = computeChainVisibleRanges([
      [
        hop({ compositionId: "comp-210", window: window({ enabled: false, startTimeSeconds: 0, inPointSeconds: 0, outPointSeconds: 100 }) }),
        hop({ compositionId: "comp-210", window: window({ enabled: false, startTimeSeconds: 20, inPointSeconds: 20, outPointSeconds: 100 }) })
      ],
      [hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 5 }) })]
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("None of the 2 candidate host layers");
    expect(result.reason).toContain("is disabled");
  });

  it("a single-candidate slot's failure reason is reported verbatim, never wrapped with the multi-candidate framing", () => {
    const result = computeChainVisibleRanges([
      [hop({ compositionId: "comp-210", window: window({ enabled: false }) })],
      [hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 5 }) })]
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).not.toContain("None of the");
    expect(result.reason).toContain("is disabled");
  });
});

describe("calculatePreviewTiming", () => {
  function chain(label: string, hops: ChainHop[]): LabeledChain {
    return { label, hopSlots: slots(hops) };
  }

  it("computes the real overlap between two labels with different timing, and recommends the midpoint of the largest overlap", () => {
    const result = calculatePreviewTiming([
      chain("Logo", [hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 7 }) }), hop({ compositionId: "comp-2", window: window({ inPointSeconds: 2, outPointSeconds: 6 }) })]),
      chain("Hebrew", [hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 7 }) }), hop({ compositionId: "comp-2", window: window({ layerIndex: 4, inPointSeconds: 3, outPointSeconds: 7 }) })])
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rangesByLabel.Logo).toEqual([[2, 6]]);
    expect(result.rangesByLabel.Hebrew).toEqual([[3, 7]]);
    expect(result.overlapRanges).toEqual([[3, 6]]);
    expect(result.usedOverlap).toBe(true);
    expect(result.recommendedTimestampSeconds).toBe(4.5);
  });

  it("falls back to the single largest range across every label (never a guess) when nothing overlaps, and reports usedOverlap:false", () => {
    const result = calculatePreviewTiming([
      chain("Logo", [hop({ compositionId: "comp-1", window: window({ inPointSeconds: 0, outPointSeconds: 2 }) })]),
      chain("Hebrew", [hop({ compositionId: "comp-1", window: window({ layerIndex: 4, inPointSeconds: 5, outPointSeconds: 15 }) })])
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overlapRanges).toEqual([]);
    expect(result.usedOverlap).toBe(false);
    // Hebrew's own [5,15] (width 10) is larger than Logo's [0,2] (width 2).
    expect(result.recommendedTimestampSeconds).toBe(10);
  });

  it("real 2026-09-10 incident, end to end: with the fix (opacity now factored in), the Hebrew chain refuses outright rather than recommending a timestamp where it is confirmed invisible", () => {
    const logoChain = chain("App Logo", [
      hop({ compositionId: "comp-210", window: window({ inPointSeconds: 0, outPointSeconds: 45.045045045045 }) }),
      hop({ compositionId: "comp-1", window: window({ layerIndex: 3, inPointSeconds: 1.63496830163497, outPointSeconds: 8.64197530864197, startTimeSeconds: 1.63496830163497 }) }),
      hop({ compositionId: "comp-1635", window: window({ layerIndex: 1, inPointSeconds: 0, outPointSeconds: 10.01001001001 }) })
    ]);
    const hebrewChain = chain("Hebrew Branding", [
      hop({ compositionId: "comp-210", window: window({ inPointSeconds: 0, outPointSeconds: 45.045045045045 }) }),
      hop({ compositionId: "comp-1", window: window({ layerIndex: 3, inPointSeconds: 1.63496830163497, outPointSeconds: 8.64197530864197, startTimeSeconds: 1.63496830163497 }) }),
      hop({
        compositionId: "comp-1635",
        window: window({ layerIndex: 4, inPointSeconds: 0.96763430096763, outPointSeconds: 5.63897230563897, startTimeSeconds: -2.53586920253587 }),
        opacity: { staticPercent: 0, keyframes: null }
      })
    ]);

    const result = calculatePreviewTiming([logoChain, hebrewChain]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Hebrew Branding");
    expect(result.reason).toContain("confirmed opacity 0");
  });

  it("refuses with an empty chains list", () => {
    expect(calculatePreviewTiming([])).toEqual({ ok: false, reason: expect.stringContaining("No chains") });
  });
});
