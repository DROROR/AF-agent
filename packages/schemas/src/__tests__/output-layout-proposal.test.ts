import { describe, expect, it } from "vitest";
import {
  BACKGROUND_COVERAGE_RATIO,
  outputLayoutProposalSchema,
  proposeOutputLayout,
  REELS_OUTPUT_HEIGHT_PX,
  REELS_OUTPUT_WIDTH_PX,
  type MeasuredLayerGeometry,
  type OutputLayoutProposal
} from "../output-layout-proposal.js";

/**
 * The two REAL 2026-09-27 failures this rule exists to close are asserted
 * by name below, in the shape they actually happened:
 *
 *   1. positions mapped, scale left alone -> full-width artwork sliced off
 *      at both edges of the narrower frame,
 *   2. everything scaled by width -> the background shrank and left the
 *      top of the video black.
 *
 * No test here names a real template, and no layer name carries meaning:
 * the "never read a layer's name" rule has a test of its own.
 */

/** A frame deliberately unlike the output frame, so nothing can pass by coincidence of equal numbers. */
const SOURCE_FRAME = { widthPx: 1600, heightPx: 900 };
const TARGET_FRAME = { widthPx: REELS_OUTPUT_WIDTH_PX, heightPx: REELS_OUTPUT_HEIGHT_PX };

function layer(overrides: Partial<MeasuredLayerGeometry> & { layerIndex: number }): MeasuredLayerGeometry {
  return {
    layerName: `layer ${overrides.layerIndex}`,
    enabled: true,
    threeDLayer: false,
    isCameraLayer: false,
    hasVideo: true,
    parented: false,
    position: { animated: false, currentValue: [0, 0] },
    scale: { animated: false, currentValue: [100, 100] },
    anchorPoint: { animated: false, currentValue: [0, 0] },
    bounds: { left: 0, top: 0, width: 10, height: 10 },
    ...overrides
  };
}

/**
 * A layer placed by its own centre - the ordinary case in a real
 * template, and the one that exercises the anchor-point half of the
 * transform formula rather than a convenient (0,0) corner.
 */
function centredLayer(params: { layerIndex: number; width: number; height: number; centreX: number; centreY: number; scalePercent?: number }): MeasuredLayerGeometry {
  const scalePercent = params.scalePercent ?? 100;
  return layer({
    layerIndex: params.layerIndex,
    position: { animated: false, currentValue: [params.centreX, params.centreY] },
    scale: { animated: false, currentValue: [scalePercent, scalePercent] },
    anchorPoint: { animated: false, currentValue: [params.width / 2, params.height / 2] },
    bounds: { left: 0, top: 0, width: params.width, height: params.height }
  });
}

function proposalOf(layers: MeasuredLayerGeometry[], frames?: { sourceFrame: { widthPx: number; heightPx: number }; targetFrame: { widthPx: number; heightPx: number } }): OutputLayoutProposal {
  const result = proposeOutputLayout({
    sourceFrame: frames?.sourceFrame ?? SOURCE_FRAME,
    targetFrame: frames?.targetFrame ?? TARGET_FRAME,
    layers
  });
  if (!result.ok) {
    throw new Error(`expected a proposal, got: ${result.reason}`);
  }
  return result.proposal;
}

describe("proposeOutputLayout - background vs content (real 2026-09-27 hand-authored Reels layout incident)", () => {
  it("a full-frame background layer is proposed at COVER scale - it fills the target frame with no gap on either axis", () => {
    const background = centredLayer({ layerIndex: 1, width: SOURCE_FRAME.widthPx, height: SOURCE_FRAME.heightPx, centreX: SOURCE_FRAME.widthPx / 2, centreY: SOURCE_FRAME.heightPx / 2 });
    const proposal = proposalOf([background]);

    const entry = proposal.proposals[0];
    expect(entry).toBeDefined();
    expect(entry?.role).toBe("BACKGROUND");
    const bounds = entry!.proposedBounds;
    expect(bounds.left).toBeLessThanOrEqual(0);
    expect(bounds.top).toBeLessThanOrEqual(0);
    expect(bounds.left + bounds.width).toBeGreaterThanOrEqual(TARGET_FRAME.widthPx);
    expect(bounds.top + bounds.height).toBeGreaterThanOrEqual(TARGET_FRAME.heightPx);
  });

  it("FAILURE 2 - the background is NOT scaled by the width ratio, which is what left the top of the real video black", () => {
    const background = centredLayer({ layerIndex: 1, width: SOURCE_FRAME.widthPx, height: SOURCE_FRAME.heightPx, centreX: SOURCE_FRAME.widthPx / 2, centreY: SOURCE_FRAME.heightPx / 2 });
    const naiveWidthFitPercent = (TARGET_FRAME.widthPx / SOURCE_FRAME.widthPx) * 100;

    const entry = proposalOf([background]).proposals[0];

    expect(entry?.scalePercent).toBeGreaterThan(naiveWidthFitPercent);
    // The exact cover factor: the taller axis wins for a landscape source
    // in a portrait frame (rounded UP, never down - a background rounded
    // down stops covering).
    expect(entry?.scalePercent).toBeCloseTo((TARGET_FRAME.heightPx / SOURCE_FRAME.heightPx) * 100, 2);
    expect(entry?.scalePercent).toBeGreaterThanOrEqual((TARGET_FRAME.heightPx / SOURCE_FRAME.heightPx) * 100);
  });

  it("a smaller content layer is NOT rescaled - it keeps its own real pixel scale so the template's visual hierarchy survives", () => {
    const background = centredLayer({ layerIndex: 1, width: SOURCE_FRAME.widthPx, height: SOURCE_FRAME.heightPx, centreX: SOURCE_FRAME.widthPx / 2, centreY: SOURCE_FRAME.heightPx / 2 });
    const badge = centredLayer({ layerIndex: 2, width: 180, height: 60, centreX: SOURCE_FRAME.widthPx / 2, centreY: SOURCE_FRAME.heightPx / 2 });

    const proposal = proposalOf([background, badge]);

    const badgeEntry = proposal.proposals.find((entry) => entry.layerIndex === 2);
    expect(badgeEntry?.role).toBe("CONTENT");
    expect(badgeEntry?.scalePercent).toBe(100);
    // Dead centre in the source stays dead centre in the target.
    expect(badgeEntry?.positionX).toBeCloseTo(TARGET_FRAME.widthPx / 2, 3);
    expect(badgeEntry?.positionY).toBeCloseTo(TARGET_FRAME.heightPx / 2, 3);
  });

  it("the two are told apart by measured coverage alone - a layer just under the coverage ratio is content, just over it is background", () => {
    const justUnder = BACKGROUND_COVERAGE_RATIO - 0.02;
    const justOver = BACKGROUND_COVERAGE_RATIO + 0.02;
    const nearlyFull = centredLayer({
      layerIndex: 1,
      width: SOURCE_FRAME.widthPx * justUnder,
      height: SOURCE_FRAME.heightPx * justUnder,
      centreX: SOURCE_FRAME.widthPx / 2,
      centreY: SOURCE_FRAME.heightPx / 2
    });
    const full = centredLayer({
      layerIndex: 2,
      width: SOURCE_FRAME.widthPx * justOver,
      height: SOURCE_FRAME.heightPx * justOver,
      centreX: SOURCE_FRAME.widthPx / 2,
      centreY: SOURCE_FRAME.heightPx / 2
    });

    const proposal = proposalOf([nearlyFull, full]);

    expect(proposal.proposals.find((entry) => entry.layerIndex === 1)?.role).toBe("CONTENT");
    expect(proposal.proposals.find((entry) => entry.layerIndex === 2)?.role).toBe("BACKGROUND");
  });
});

describe("proposeOutputLayout - nothing is ever proposed outside the target frame", () => {
  it("FAILURE 1 - a headline as wide as the source frame is shrunk to fit instead of being sliced off at both edges", () => {
    const headline = centredLayer({ layerIndex: 1, width: SOURCE_FRAME.widthPx, height: 120, centreX: SOURCE_FRAME.widthPx / 2, centreY: 200 });

    const entry = proposalOf([headline]).proposals[0];

    expect(entry?.role).toBe("CONTENT");
    expect(entry?.scalePercent).toBeCloseTo((TARGET_FRAME.widthPx / SOURCE_FRAME.widthPx) * 100, 3);
    expect(entry!.proposedBounds.left).toBeGreaterThanOrEqual(-0.01);
    expect(entry!.proposedBounds.left + entry!.proposedBounds.width).toBeLessThanOrEqual(TARGET_FRAME.widthPx + 0.01);
  });

  it("every CONTENT proposal - including layers hard against the source frame's own edges and corners - lands wholly inside the target frame", () => {
    const edgeLayers = [
      centredLayer({ layerIndex: 1, width: 400, height: 100, centreX: 0, centreY: 0 }),
      centredLayer({ layerIndex: 2, width: 400, height: 100, centreX: SOURCE_FRAME.widthPx, centreY: 0 }),
      centredLayer({ layerIndex: 3, width: 400, height: 100, centreX: 0, centreY: SOURCE_FRAME.heightPx }),
      centredLayer({ layerIndex: 4, width: 400, height: 100, centreX: SOURCE_FRAME.widthPx, centreY: SOURCE_FRAME.heightPx }),
      centredLayer({ layerIndex: 5, width: 900, height: 700, centreX: SOURCE_FRAME.widthPx - 30, centreY: SOURCE_FRAME.heightPx - 20, scalePercent: 140 })
    ];

    const proposal = proposalOf(edgeLayers);

    expect(proposal.proposals).toHaveLength(edgeLayers.length);
    for (const entry of proposal.proposals) {
      expect(entry.role).toBe("CONTENT");
      expect(entry.proposedBounds.left).toBeGreaterThanOrEqual(-0.01);
      expect(entry.proposedBounds.top).toBeGreaterThanOrEqual(-0.01);
      expect(entry.proposedBounds.left + entry.proposedBounds.width).toBeLessThanOrEqual(TARGET_FRAME.widthPx + 0.01);
      expect(entry.proposedBounds.top + entry.proposedBounds.height).toBeLessThanOrEqual(TARGET_FRAME.heightPx + 0.01);
    }
  });

  it("a content layer is only ever shrunk, never enlarged, to fit", () => {
    const small = centredLayer({ layerIndex: 1, width: 40, height: 40, centreX: 100, centreY: 100 });

    expect(proposalOf([small]).proposals[0]?.scalePercent).toBe(100);
  });
});

describe("proposeOutputLayout - refusals are reported WITH the reason, never silently dropped", () => {
  const cases: Array<{ what: string; layer: MeasuredLayerGeometry; reason: string }> = [
    {
      what: "a layer with keyframed position",
      layer: layer({ layerIndex: 1, position: { animated: true, currentValue: [10, 20] } }),
      reason: "KEYFRAMED_POSITION_OR_SCALE"
    },
    {
      what: "a layer with keyframed scale",
      layer: layer({ layerIndex: 1, scale: { animated: true, currentValue: [100, 100] } }),
      reason: "KEYFRAMED_POSITION_OR_SCALE"
    },
    { what: "a 3D layer", layer: layer({ layerIndex: 1, threeDLayer: true }), reason: "THREE_D_LAYER" },
    { what: "a parented layer", layer: layer({ layerIndex: 1, parented: true }), reason: "PARENTED_LAYER" },
    { what: "a camera", layer: layer({ layerIndex: 1, isCameraLayer: true, scale: null, bounds: null }), reason: "CAMERA_LAYER" },
    { what: "a disabled layer", layer: layer({ layerIndex: 1, enabled: false }), reason: "LAYER_DISABLED" },
    { what: "a layer with no video component", layer: layer({ layerIndex: 1, hasVideo: false }), reason: "NO_VIDEO_CONTENT" },
    {
      what: "a layer scaled differently on X and Y (an approved transform carries one uniform scale)",
      layer: layer({ layerIndex: 1, scale: { animated: false, currentValue: [100, 140] } }),
      reason: "NON_UNIFORM_SOURCE_SCALE"
    },
    { what: "a layer with no readable bounding box", layer: layer({ layerIndex: 1, bounds: null }), reason: "UNREADABLE_BOUNDS" },
    {
      what: "a layer whose transform is not a pair of real numbers",
      layer: layer({ layerIndex: 1, position: { animated: false, currentValue: 42 } }),
      reason: "UNREADABLE_TRANSFORM"
    },
    {
      what: "a mirrored (negatively scaled) layer, which has no honest single uniform transform",
      layer: layer({ layerIndex: 1, scale: { animated: false, currentValue: [-100, -100] } }),
      reason: "DEGENERATE_GEOMETRY"
    },
    {
      what: "a layer read by a scan that never reported parenting or a video component",
      layer: layer({ layerIndex: 1, hasVideo: undefined, parented: undefined, bounds: undefined }),
      reason: "GEOMETRY_NOT_MEASURED"
    }
  ];

  for (const testCase of cases) {
    it(`refuses ${testCase.what} with reason ${testCase.reason}, and proposes nothing for it`, () => {
      const proposal = proposalOf([testCase.layer]);

      expect(proposal.proposals).toEqual([]);
      expect(proposal.refusals).toHaveLength(1);
      expect(proposal.refusals[0]?.reason).toBe(testCase.reason);
      expect(proposal.refusals[0]?.layerIndex).toBe(1);
      expect(proposal.refusals[0]?.detail.length).toBeGreaterThan(0);
    });
  }

  it("a refused layer never removes the proposal for the layers around it", () => {
    const animated = layer({ layerIndex: 1, position: { animated: true, currentValue: [10, 20] } });
    const usable = centredLayer({ layerIndex: 2, width: 200, height: 80, centreX: 300, centreY: 300 });

    const proposal = proposalOf([animated, usable]);

    expect(proposal.refusals.map((refusal) => refusal.layerIndex)).toEqual([1]);
    expect(proposal.proposals.map((entry) => entry.layerIndex)).toEqual([2]);
  });

  it("every layer handed in comes back exactly once, as a proposal or as a refusal - a layer can never vanish", () => {
    const layers = [
      centredLayer({ layerIndex: 1, width: SOURCE_FRAME.widthPx, height: SOURCE_FRAME.heightPx, centreX: 800, centreY: 450 }),
      layer({ layerIndex: 2, threeDLayer: true }),
      centredLayer({ layerIndex: 3, width: 120, height: 120, centreX: 200, centreY: 700 }),
      layer({ layerIndex: 4, scale: { animated: true, currentValue: [100, 100] } }),
      layer({ layerIndex: 5, enabled: false }),
      layer({ layerIndex: 6, isCameraLayer: true, scale: null, bounds: null })
    ];

    const proposal = proposalOf(layers);

    const seen = [...proposal.proposals.map((entry) => entry.layerIndex), ...proposal.refusals.map((refusal) => refusal.layerIndex)].sort((a, b) => a - b);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("proposeOutputLayout - the rule itself", () => {
  it("never reads a layer's name: renaming every layer changes nothing but the labels", () => {
    const layers = [
      centredLayer({ layerIndex: 1, width: SOURCE_FRAME.widthPx, height: SOURCE_FRAME.heightPx, centreX: 800, centreY: 450 }),
      centredLayer({ layerIndex: 2, width: 300, height: 90, centreX: 400, centreY: 200 }),
      layer({ layerIndex: 3, threeDLayer: true })
    ];
    const misleadingNames = ["logo", "TEXT 01", "BG"];
    const renamed = layers.map((entry, index) => ({ ...entry, layerName: misleadingNames[index] ?? "" }));

    const original = proposalOf(layers);
    const afterRename = proposalOf(renamed);

    expect(afterRename.proposals.map(({ layerName, ...rest }) => rest)).toEqual(original.proposals.map(({ layerName, ...rest }) => rest));
    expect(afterRename.refusals.map(({ layerName, ...rest }) => rest)).toEqual(original.refusals.map(({ layerName, ...rest }) => rest));
  });

  it("is target-agnostic: the same rule fills a wide frame from a tall source, with no dimension baked into it", () => {
    const tallSource = { widthPx: 1080, heightPx: 1350 };
    const wideTarget = { widthPx: 1920, heightPx: 1080 };
    const background = centredLayer({ layerIndex: 1, width: tallSource.widthPx, height: tallSource.heightPx, centreX: tallSource.widthPx / 2, centreY: tallSource.heightPx / 2 });
    const badge = centredLayer({ layerIndex: 2, width: 200, height: 200, centreX: tallSource.widthPx / 4, centreY: tallSource.heightPx / 4 });

    const proposal = proposalOf([background, badge], { sourceFrame: tallSource, targetFrame: wideTarget });

    const backgroundBounds = proposal.proposals.find((entry) => entry.layerIndex === 1)!.proposedBounds;
    expect(backgroundBounds.left).toBeLessThanOrEqual(0);
    expect(backgroundBounds.left + backgroundBounds.width).toBeGreaterThanOrEqual(wideTarget.widthPx);
    expect(backgroundBounds.top + backgroundBounds.height).toBeGreaterThanOrEqual(wideTarget.heightPx);

    const badgeEntry = proposal.proposals.find((entry) => entry.layerIndex === 2)!;
    expect(badgeEntry.scalePercent).toBe(100);
    expect(badgeEntry.positionX).toBeCloseTo(wideTarget.widthPx / 4, 3);
    expect(badgeEntry.positionY).toBeCloseTo(wideTarget.heightPx / 4, 3);
  });

  it("is deterministic - the same measured facts always produce the identical proposal", () => {
    const layers = [
      centredLayer({ layerIndex: 1, width: SOURCE_FRAME.widthPx, height: SOURCE_FRAME.heightPx, centreX: 800, centreY: 450 }),
      centredLayer({ layerIndex: 2, width: 333, height: 97, centreX: 1201, centreY: 733, scalePercent: 73 })
    ];

    expect(proposalOf(layers)).toEqual(proposalOf(layers));
  });

  it("produces output that satisfies its own published schema, so it can cross the worker/API boundary unchanged", () => {
    const layers = [
      centredLayer({ layerIndex: 1, width: SOURCE_FRAME.widthPx, height: SOURCE_FRAME.heightPx, centreX: 800, centreY: 450 }),
      layer({ layerIndex: 2, parented: true })
    ];

    expect(() => outputLayoutProposalSchema.parse(proposalOf(layers))).not.toThrow();
  });

  it("records the frames it actually worked in and the threshold it actually used, so a stored proposal can be re-derived", () => {
    const proposal = proposalOf([centredLayer({ layerIndex: 1, width: 100, height: 100, centreX: 100, centreY: 100 })]);

    expect(proposal.sourceFrame).toEqual(SOURCE_FRAME);
    expect(proposal.targetFrame).toEqual(TARGET_FRAME);
    expect(proposal.backgroundCoverageRatio).toBe(BACKGROUND_COVERAGE_RATIO);
  });

  it("fails closed, with a reason, when the source composition's own frame was never measured", () => {
    const result = proposeOutputLayout({
      sourceFrame: { widthPx: 0, heightPx: 0 },
      targetFrame: TARGET_FRAME,
      layers: [centredLayer({ layerIndex: 1, width: 100, height: 100, centreX: 50, centreY: 50 })]
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/frame size/);
  });
});
