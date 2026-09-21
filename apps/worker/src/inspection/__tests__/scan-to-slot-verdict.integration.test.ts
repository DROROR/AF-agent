import { describe, expect, it } from "vitest";
import { parseProjectPreflightScan } from "../parse-project-preflight-scan.js";
import { buildProjectFacts } from "../build-project-facts.js";
import { buildTemplateManifest } from "../build-manifest.js";
import type { CompositionDetail, CompositionSummary } from "../parse-mcp-shapes.js";

/**
 * THE WHOLE CHAIN, FOR REAL: project scan -> buildProjectFacts ->
 * buildTemplateManifest -> slot verdicts.
 *
 * WHY THIS EXISTS (2026-09-21). Every slot-facts unit test builds the scan map
 * itself and calls `buildSlotStructuralFacts` directly. That left one join
 * untested - `buildProjectFacts` consumed `layerFactsByCompositionAndIndex` and
 * forgot to RETURN it - so in production every structural verdict came out
 * `unknown` with no facts at all, while 4,075 unit tests passed. The first real
 * After Effects smoke test caught it. This test runs the same path the worker
 * runs, from the raw scan JSON onwards, so the join cannot silently break again.
 *
 * The scan payload below mirrors the shape a real AE run returns (confirmed
 * against the 2026-09-21 QA inspection), with two hosts that differ in ONE
 * respect: what their matte is made of.
 */

const SCENE_ID = 34;
const SLOT_ID = 5;

/** One layer record in the scan's own shape. */
function scanLayer(overrides: {
  layerIndex: number;
  layerName: string;
  kind?: "AVLayer" | "TextLayer" | "ShapeLayer";
  footage?: { hasVideo: boolean; hasAudio: boolean; isStill: boolean; isMissing: boolean; isSolid: boolean; widthPx: number | null; heightPx: number | null } | null;
  detail?: Record<string, unknown>;
}) {
  return {
    layerIndex: overrides.layerIndex,
    layerName: overrides.layerName,
    enabled: true,
    kind: overrides.kind ?? "AVLayer",
    footage: overrides.footage ?? null,
    effects: [],
    detail: {
      isTrackMatte: false,
      hasTrackMatte: false,
      trackMatteType: "NO_TRACK_MATTE",
      trackMatteLayerIndex: null,
      guideLayer: false,
      adjustmentLayer: false,
      nullLayer: false,
      shy: false,
      threeDLayer: false,
      blendingMode: "NORMAL",
      preserveTransparency: false,
      parentLayerIndex: null,
      sourceName: overrides.layerName,
      sourceCompositionId: null,
      inPointSeconds: 0,
      outPointSeconds: 10,
      opacityAtInPoint: 100,
      opacityKeyframeCount: 0,
      textPreview: null,
      positionX: 960,
      positionY: 540,
      anchorX: 540,
      anchorY: 1080,
      scalePercent: 40,
      scalePercentY: 40,
      rotationDegrees: 0,
      hasTransformKeyframes: false,
      opacityKeyframes: null,
      ...overrides.detail
    }
  };
}

const movingFootage = { hasVideo: true, hasAudio: false, isStill: false, isMissing: false, isSolid: false, widthPx: 1080, heightPx: 2160 };
const stillFootage = { hasVideo: true, hasAudio: false, isStill: true, isMissing: false, isSolid: false, widthPx: 1080, heightPx: 2160 };

/**
 * A scene holding two hosts of the SAME slot composition, each with a properly
 * bound track matte, one made of moving footage and one of a still.
 */
const RAW_SCAN = {
  ok: true as const,
  compositionCount: 2,
  fonts: [],
  footage: [],
  compositions: [
    {
      aeProjectItemIndex: 5,
      compositionId: SCENE_ID,
      compositionName: "QA_Scene",
      layers: [
        // 1: the moving matte (an image sequence).
        scanLayer({ layerIndex: 1, layerName: "MovingPass", footage: movingFootage }),
        // 2: the host it cuts - 3D, on an animated parent.
        scanLayer({
          layerIndex: 2,
          layerName: "ScreenHost",
          detail: { hasTrackMatte: true, trackMatteType: "LUMA", trackMatteLayerIndex: 1, threeDLayer: true, parentLayerIndex: 5, inPointSeconds: 1, outPointSeconds: 7 }
        }),
        // 3: the still matte.
        scanLayer({ layerIndex: 3, layerName: "StillPass", footage: stillFootage }),
        // 4: its host - identical to layer 2 in every respect but the matte.
        scanLayer({
          layerIndex: 4,
          layerName: "StillMattedHost",
          detail: { hasTrackMatte: true, trackMatteType: "LUMA", trackMatteLayerIndex: 3, threeDLayer: true, parentLayerIndex: 5, inPointSeconds: 1, outPointSeconds: 7 }
        }),
        // 5: the animated parent both hosts hang off.
        scanLayer({ layerIndex: 5, layerName: "Helper", detail: { hasTransformKeyframes: true, threeDLayer: true } })
      ]
    },
    {
      aeProjectItemIndex: 6,
      compositionId: SLOT_ID,
      compositionName: "QA_Screen",
      layers: [scanLayer({ layerIndex: 1, layerName: "slot", footage: { ...stillFootage, isSolid: true } })]
    }
  ]
};

const sceneSummary: CompositionSummary = { index: 5, name: "QA_Scene", widthPx: 1920, heightPx: 1080, frameRate: 25, durationSeconds: 10, numLayers: 5 };
const slotSummary: CompositionSummary = { index: 6, name: "QA_Screen", widthPx: 1080, heightPx: 2160, frameRate: 25, durationSeconds: 10, numLayers: 1 };

const sceneDetail: CompositionDetail = {
  compId: SCENE_ID,
  name: "QA_Scene",
  widthPx: 1920,
  heightPx: 1080,
  frameRate: 25,
  durationSeconds: 10,
  numLayers: 5,
  layers: [
    { index: 1, name: "MovingPass", inPointSeconds: 0, outPointSeconds: 10, nullLayer: false },
    { index: 2, name: "ScreenHost", inPointSeconds: 1, outPointSeconds: 7, nullLayer: false },
    { index: 3, name: "StillPass", inPointSeconds: 0, outPointSeconds: 10, nullLayer: false },
    { index: 4, name: "StillMattedHost", inPointSeconds: 1, outPointSeconds: 7, nullLayer: false },
    { index: 5, name: "Helper", inPointSeconds: 0, outPointSeconds: 10, nullLayer: true }
  ]
};
const slotDetail: CompositionDetail = {
  compId: SLOT_ID,
  name: "QA_Screen",
  widthPx: 1080,
  heightPx: 2160,
  frameRate: 25,
  durationSeconds: 10,
  numLayers: 1,
  layers: [{ index: 1, name: "slot", inPointSeconds: 0, outPointSeconds: 10, nullLayer: false }]
};

const fixedNow = () => new Date("2026-09-21T00:00:00.000Z");

/** Runs the real chain end to end and hands back both the facts and the manifest. */
function runChain() {
  const scan = parseProjectPreflightScan(RAW_SCAN);
  if (!scan.ok) {
    throw new Error(`fixture scan did not parse: ${scan.reason}`);
  }
  const facts = buildProjectFacts({
    templateId: "qa-chain",
    sourceProjectPath: "/qa/chain.aep",
    sourceProjectName: "chain.aep",
    projectSha256: "a".repeat(64),
    aeVersion: "26.3x87",
    discovered: [sceneSummary, slotSummary],
    details: [sceneDetail, slotDetail],
    // Both hosts place the same slot composition.
    precompFacts: [
      [
        { layerIndex: 2, sourceCompositionId: `comp-${SLOT_ID}` },
        { layerIndex: 4, sourceCompositionId: `comp-${SLOT_ID}` }
      ],
      []
    ],
    layerFactsByCompositionAndIndex: scan.evidence.layerFactsByCompositionAndIndex,
    requiredFonts: scan.evidence.requiredFonts,
    footageReferenced: scan.evidence.footageReferenced,
    missingFootage: scan.evidence.missingFootage,
    pluginReferences: scan.evidence.pluginReferences
  });
  return { scan, facts, manifest: buildTemplateManifest(facts, fixedNow) };
}

describe("scan -> facts -> manifest -> slot verdicts (the real chain)", () => {
  it("carries the scan through buildProjectFacts instead of consuming and dropping it", () => {
    const { scan, facts } = runChain();
    expect(scan.ok).toBe(true);
    // THE REGRESSION: this map used to be absent on the returned facts, which
    // silently disabled every structural verdict downstream.
    expect(facts.layerFactsByCompositionAndIndex).toBeDefined();
    expect(facts.layerFactsByCompositionAndIndex.size).toBe(scan.ok ? scan.evidence.layerFactsByCompositionAndIndex.size : -1);
    expect(facts.layerFactsByCompositionAndIndex.get(`comp-${SCENE_ID}:2`)?.detail?.trackMatteType).toBe("LUMA");
  });

  it("populates REAL host facts on the slot - not a row of nulls", () => {
    const { manifest } = runChain();
    const placeholders = manifest.scenes.flatMap((scene) => scene.placeholders).filter((placeholder) => placeholder.slotFacts);
    expect(placeholders.length).toBeGreaterThan(0);

    const hosts = placeholders.flatMap((placeholder) => placeholder.slotFacts!.hosts);
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      expect(host.matteSource).not.toBe("UNKNOWN");
      expect(host.threeDLayer).not.toBeNull();
      expect(host.enabled).not.toBeNull();
      expect(host.windowSeconds).not.toBeNull();
    }

    // The animated parent and the visible window both survive the journey.
    const screenHost = hosts.find((host) => host.layerIndex === 2);
    expect(screenHost?.parentIsAnimated).toBe(true);
    expect(screenHost?.windowSeconds).toEqual({ startSeconds: 1, endSeconds: 7 });
  });

  it("moving footage and an imported still produce DIFFERENT matte sources through the whole chain", () => {
    const { manifest } = runChain();
    const hosts = manifest.scenes
      .flatMap((scene) => scene.placeholders)
      .flatMap((placeholder) => placeholder.slotFacts?.hosts ?? []);

    const movingMatted = hosts.find((host) => host.layerIndex === 2);
    const stillMatted = hosts.find((host) => host.layerIndex === 4);
    expect(movingMatted?.matteSource).toBe("RENDERED_FOOTAGE");
    expect(stillMatted?.matteSource).toBe("DRAWN_MASK_OR_SOLID");
    expect(movingMatted?.matteSource).not.toBe(stillMatted?.matteSource);
  });

  it("reaches a real verdict rather than the unknown/0.000 every slot used to get", () => {
    const { manifest } = runChain();
    const withVerdict = manifest.scenes.flatMap((scene) => scene.placeholders).filter((placeholder) => placeholder.slotSemantics);
    expect(withVerdict.length).toBeGreaterThan(0);
    for (const placeholder of withVerdict) {
      expect(placeholder.slotSemantics!.modelVersion).toBe("slot-semantics-v2");
      expect(placeholder.slotSemantics!.classification).not.toBe("unknown");
      expect(placeholder.slotSemantics!.confidence).toBeGreaterThan(0);
      expect(placeholder.slotFingerprint?.digest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("an empty scan still builds a manifest - it simply cannot classify anything", () => {
    const facts = buildProjectFacts({
      templateId: "qa-chain",
      sourceProjectPath: "/qa/chain.aep",
      sourceProjectName: "chain.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [sceneSummary, slotSummary],
      details: [sceneDetail, slotDetail],
      precompFacts: [[{ layerIndex: 2, sourceCompositionId: `comp-${SLOT_ID}` }], []],
      // The scan did not run: an EMPTY map, explicitly - the only way this can
      // now be expressed.
      layerFactsByCompositionAndIndex: new Map()
    });
    const manifest = buildTemplateManifest(facts, fixedNow);
    const hosts = manifest.scenes.flatMap((scene) => scene.placeholders).flatMap((placeholder) => placeholder.slotFacts?.hosts ?? []);
    for (const host of hosts) {
      expect(host.matteSource).toBe("UNKNOWN");
    }
    for (const placeholder of manifest.scenes.flatMap((scene) => scene.placeholders)) {
      // Unknowable, and it says so - never a confident guess.
      expect(placeholder.slotSemantics?.requiresHumanDecision ?? true).toBe(true);
    }
  });
});

/**
 * THE SHAPE THE QA FIXTURE MUST HAVE (2026-09-21, second smoke run).
 *
 * The v3 fixture gave both hosts the SAME slot composition. Two hosts of one
 * slot are two hosts of ONE slot: the classifier saw them disagree and
 * correctly reported a single conflicting verdict, so the moving-matte and
 * still-matte cases could not be told apart in the result. Each case needs its
 * own slot composition. This pins that distinction at the level the fixture
 * relies on, before it is ever run against real After Effects.
 */
describe("two hosts, two slot compositions - one verdict each", () => {
  const SECOND_SLOT_ID = 7;

  function twoSlotScan() {
    const raw = JSON.parse(JSON.stringify(RAW_SCAN)) as typeof RAW_SCAN;
    // The still-matted host now places its OWN slot composition.
    raw.compositions.push({
      aeProjectItemIndex: 7,
      compositionId: SECOND_SLOT_ID,
      compositionName: "QA_ScreenStill",
      layers: [scanLayer({ layerIndex: 1, layerName: "slot", footage: { ...stillFootage, isSolid: true } })]
    });
    return raw;
  }

  it("gives the moving-matte slot a confident device screen and the still-matte slot a conflicting verdict", () => {
    const scan = parseProjectPreflightScan(twoSlotScan());
    if (!scan.ok) {
      throw new Error(scan.reason);
    }
    const stillSlotSummary: CompositionSummary = { index: 7, name: "QA_ScreenStill", widthPx: 1080, heightPx: 2160, frameRate: 25, durationSeconds: 10, numLayers: 1 };
    const stillSlotDetail: CompositionDetail = {
      compId: SECOND_SLOT_ID,
      name: "QA_ScreenStill",
      widthPx: 1080,
      heightPx: 2160,
      frameRate: 25,
      durationSeconds: 10,
      numLayers: 1,
      layers: [{ index: 1, name: "slot", inPointSeconds: 0, outPointSeconds: 10, nullLayer: false }]
    };
    const facts = buildProjectFacts({
      templateId: "qa-chain",
      sourceProjectPath: "/qa/chain.aep",
      sourceProjectName: "chain.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [sceneSummary, slotSummary, stillSlotSummary],
      details: [sceneDetail, slotDetail, stillSlotDetail],
      precompFacts: [
        [
          { layerIndex: 2, sourceCompositionId: `comp-${SLOT_ID}` },
          { layerIndex: 4, sourceCompositionId: `comp-${SECOND_SLOT_ID}` }
        ],
        [],
        []
      ],
      layerFactsByCompositionAndIndex: scan.evidence.layerFactsByCompositionAndIndex
    });
    const manifest = buildTemplateManifest(facts, fixedNow);
    const placeholders = manifest.scenes.flatMap((scene) => scene.placeholders).filter((placeholder) => placeholder.slotFacts);

    const movingSlot = placeholders.find((placeholder) => placeholder.slotFacts!.slotCompositionId === `comp-${SLOT_ID}`);
    const stillSlot = placeholders.find((placeholder) => placeholder.slotFacts!.slotCompositionId === `comp-${SECOND_SLOT_ID}`);
    expect(movingSlot).toBeDefined();
    expect(stillSlot).toBeDefined();

    // Each slot has exactly ONE host, so each gets its own verdict.
    expect(movingSlot!.slotFacts!.hosts).toHaveLength(1);
    expect(stillSlot!.slotFacts!.hosts).toHaveLength(1);
    expect(movingSlot!.slotFacts!.hosts[0]!.matteSource).toBe("RENDERED_FOOTAGE");
    expect(stillSlot!.slotFacts!.hosts[0]!.matteSource).toBe("DRAWN_MASK_OR_SOLID");

    // The moving matte is a confident screen; the still matte argues both ways
    // and is handed to a human instead.
    expect(movingSlot!.slotSemantics!.classification).toBe("device_screen");
    expect(movingSlot!.slotSemantics!.requiresHumanDecision).toBe(false);
    expect(stillSlot!.slotSemantics!.conflicting).toBe(true);
    expect(stillSlot!.slotSemantics!.requiresHumanDecision).toBe(true);
    expect(stillSlot!.slotSemantics!.confidence).toBeLessThan(movingSlot!.slotSemantics!.confidence);
  });

  it("REGRESSION: sharing one slot composition collapses them into a single conflicting verdict", () => {
    // This is exactly what the v3 fixture produced, and why it could not show
    // the two matte types apart - kept so the difference stays visible.
    const { manifest } = runChain();
    const shared = manifest.scenes.flatMap((scene) => scene.placeholders).find((placeholder) => placeholder.slotFacts?.hosts.length === 2);
    expect(shared).toBeDefined();
    expect(shared!.slotSemantics!.conflicting).toBe(true);
    expect(shared!.slotSemantics!.requiresHumanDecision).toBe(true);
  });
});
