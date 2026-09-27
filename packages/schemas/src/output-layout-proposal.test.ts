import { describe, expect, it } from "vitest";
import {
  BACKGROUND_COVERAGE_RATIO,
  OUTPUT_LAYOUT_REFUSAL_REASONS,
  REELS_OUTPUT_HEIGHT_PX,
  REELS_OUTPUT_WIDTH_PX,
  outputLayoutProposalSchema,
  proposeOutputLayout,
  type MeasuredLayerGeometry,
  type OutputFrame,
  type OutputLayoutProposal
} from "./output-layout-proposal.js";

/**
 * The rule that decides a vertical layout had no tests at all until now,
 * which is how BOTH of the failures its own doc comment describes reached
 * a real rendered video: artwork sliced off at the edges, and a background
 * that shrank until the top of the frame came out plain black. Those two
 * are not style opinions - they are geometric invariants, and they are
 * what this file pins down.
 *
 * NO TEMPLATE APPEARS HERE. Every frame, box and coordinate below is a
 * plain round number chosen to make one rule legible. The module under
 * test is forbidden from reading a layer's name (its own doc comment), so
 * the names here are deliberately misleading in places - that is the
 * point of the last test.
 */

/** A 16:9 source, the shape the Reels rule has to adapt FROM - a proportion, not any template's real size. */
const SOURCE: OutputFrame = { widthPx: 1920, heightPx: 1080 };
const TARGET: OutputFrame = { widthPx: REELS_OUTPUT_WIDTH_PX, heightPx: REELS_OUTPUT_HEIGHT_PX };

/**
 * One layer with every field the rule needs already readable and benign,
 * so each test overrides ONLY the fact it is about. An unparameterised
 * layer is a plain, enabled, 2D, unparented, unkeyframed, uniformly
 * scaled layer with a readable box.
 */
function layer(overrides: Partial<MeasuredLayerGeometry> = {}): MeasuredLayerGeometry {
  return {
    layerIndex: 1,
    layerName: "a layer",
    enabled: true,
    threeDLayer: false,
    isCameraLayer: false,
    hasVideo: true,
    parented: false,
    position: { animated: false, currentValue: [960, 540] },
    scale: { animated: false, currentValue: [100, 100] },
    anchorPoint: { animated: false, currentValue: [0, 0] },
    bounds: { left: 0, top: 0, width: 400, height: 200 },
    ...overrides
  };
}

/** A layer whose measured box fills the whole source frame - what the rule must classify as BACKGROUND. */
function fullFrameLayer(overrides: Partial<MeasuredLayerGeometry> = {}): MeasuredLayerGeometry {
  return layer({
    position: { animated: false, currentValue: [0, 0] },
    anchorPoint: { animated: false, currentValue: [0, 0] },
    bounds: { left: 0, top: 0, width: SOURCE.widthPx, height: SOURCE.heightPx },
    ...overrides
  });
}

function propose(layers: readonly MeasuredLayerGeometry[], source: OutputFrame = SOURCE, target: OutputFrame = TARGET): OutputLayoutProposal {
  const result = proposeOutputLayout({ sourceFrame: source, targetFrame: target, layers });
  if (!result.ok) {
    throw new Error(`expected a proposal, got a refusal: ${result.reason}`);
  }
  return result.proposal;
}

function onlyRefusal(layers: readonly MeasuredLayerGeometry[]) {
  const proposal = propose(layers);
  expect(proposal.proposals).toHaveLength(0);
  expect(proposal.refusals).toHaveLength(1);
  return proposal.refusals[0]!;
}

describe("proposeOutputLayout", () => {
  describe("the black-band failure: a background must cover the target frame", () => {
    it("scales a full-frame layer UP until its box covers the target on BOTH axes", () => {
      const [entry] = propose([fullFrameLayer()]).proposals;
      expect(entry!.role).toBe("BACKGROUND");
      // The whole point: covering, not fitting. Fitting 1920x1080 into a
      // 1080-wide frame is a scale of 56.25% and leaves the top and bottom
      // black; covering needs 1920/1080 of the height.
      expect(entry!.scalePercent).toBeGreaterThan(100);
      expect(entry!.proposedBounds.left).toBeLessThanOrEqual(0);
      expect(entry!.proposedBounds.top).toBeLessThanOrEqual(0);
      expect(entry!.proposedBounds.left + entry!.proposedBounds.width).toBeGreaterThanOrEqual(TARGET.widthPx);
      expect(entry!.proposedBounds.top + entry!.proposedBounds.height).toBeGreaterThanOrEqual(TARGET.heightPx);
    });

    it("still covers when the source is TALLER than the target, where the overflow lands on the other axis", () => {
      const tallSource: OutputFrame = { widthPx: 1080, heightPx: 2400 };
      const [entry] = propose(
        [
          fullFrameLayer({
            bounds: { left: 0, top: 0, width: tallSource.widthPx, height: tallSource.heightPx }
          })
        ],
        tallSource
      ).proposals;
      expect(entry!.role).toBe("BACKGROUND");
      expect(entry!.proposedBounds.left + entry!.proposedBounds.width).toBeGreaterThanOrEqual(TARGET.widthPx);
      expect(entry!.proposedBounds.top + entry!.proposedBounds.height).toBeGreaterThanOrEqual(TARGET.heightPx);
    });

    it("covers with NOTHING to spare when source and target are the same shape - the case rounding could break", () => {
      // Same aspect ratio, so both cover factors are equal and the result
      // touches all four edges exactly. If a scale were ever rounded DOWN,
      // this is the case that would open a hairline black edge.
      const sameShape: OutputFrame = { widthPx: TARGET.widthPx / 2, heightPx: TARGET.heightPx / 2 };
      const [entry] = propose(
        [fullFrameLayer({ bounds: { left: 0, top: 0, width: sameShape.widthPx, height: sameShape.heightPx } })],
        sameShape
      ).proposals;
      expect(entry!.proposedBounds.left + entry!.proposedBounds.width).toBeGreaterThanOrEqual(TARGET.widthPx);
      expect(entry!.proposedBounds.top + entry!.proposedBounds.height).toBeGreaterThanOrEqual(TARGET.heightPx);
    });

    it("treats a layer just OVER the coverage threshold as background and one just under it as content", () => {
      const over = BACKGROUND_COVERAGE_RATIO * SOURCE.widthPx;
      const overHeight = BACKGROUND_COVERAGE_RATIO * SOURCE.heightPx;
      const background = propose([fullFrameLayer({ bounds: { left: 0, top: 0, width: over, height: overHeight } })]).proposals[0];
      expect(background!.role).toBe("BACKGROUND");

      const content = propose([fullFrameLayer({ bounds: { left: 0, top: 0, width: over - 1, height: overHeight } })]).proposals[0];
      expect(content!.role).toBe("CONTENT");
    });

    it("judges coverage on the layer's REAL on-screen size, so a big box scaled down to nothing is content, not background", () => {
      const [entry] = propose([
        fullFrameLayer({
          // A full-frame box at 10% covers a tenth of the frame. Reading
          // the raw bounds and ignoring scale would misclassify it as a
          // background and blow it up to cover the whole video.
          scale: { animated: false, currentValue: [10, 10] }
        })
      ]).proposals;
      expect(entry!.role).toBe("CONTENT");
    });
  });

  describe("the sliced-edges failure: content must stay inside the target frame", () => {
    it("never leaves a content layer's box outside the frame, even when it started far off-centre", () => {
      const [entry] = propose([
        layer({
          // Near the right edge of a 16:9 frame: mapping the position
          // without clamping puts most of this box outside a 1080-wide one.
          position: { animated: false, currentValue: [1800, 540] },
          bounds: { left: 0, top: 0, width: 400, height: 200 }
        })
      ]).proposals;
      expect(entry!.proposedBounds.left).toBeGreaterThanOrEqual(0);
      expect(entry!.proposedBounds.top).toBeGreaterThanOrEqual(0);
      expect(entry!.proposedBounds.left + entry!.proposedBounds.width).toBeLessThanOrEqual(TARGET.widthPx);
      expect(entry!.proposedBounds.top + entry!.proposedBounds.height).toBeLessThanOrEqual(TARGET.heightPx);
    });

    it("shrinks a content layer that is WIDER than the target frame until it fits, and no further", () => {
      const [entry] = propose([
        layer({
          // Wide enough to overflow 1080, but not tall enough to be a background.
          bounds: { left: 0, top: 0, width: 1800, height: 100 }
        })
      ]).proposals;
      expect(entry!.role).toBe("CONTENT");
      expect(entry!.proposedBounds.width).toBeLessThanOrEqual(TARGET.widthPx);
      expect(entry!.scalePercent).toBeLessThan(100);
    });

    it("leaves a content layer that already fits at its OWN pixel scale - the template's hierarchy is not rescaled", () => {
      const [entry] = propose([layer({ scale: { animated: false, currentValue: [80, 80] } })]).proposals;
      // Only ever shrunk, never enlarged: a small layer is not blown up to
      // fill the taller frame just because there is now room for it.
      expect(entry!.scalePercent).toBe(80);
    });

    it("keeps a content layer at the same PROPORTIONAL place in the frame", () => {
      // A small box centred in the source should still be centred in the target.
      const [entry] = propose([
        layer({
          position: { animated: false, currentValue: [SOURCE.widthPx / 2 - 50, SOURCE.heightPx / 2 - 25] },
          bounds: { left: 0, top: 0, width: 100, height: 50 }
        })
      ]).proposals;
      const centreX = entry!.proposedBounds.left + entry!.proposedBounds.width / 2;
      const centreY = entry!.proposedBounds.top + entry!.proposedBounds.height / 2;
      expect(centreX).toBeCloseTo(TARGET.widthPx / 2, 1);
      expect(centreY).toBeCloseTo(TARGET.heightPx / 2, 1);
    });

    it("honours a non-zero anchor point when it works out where the box really sits", () => {
      // Same box, same position, but anchored at its own centre - so it
      // sits half a box up and left of where a zero anchor would put it.
      const anchored = propose([
        layer({
          position: { animated: false, currentValue: [960, 540] },
          anchorPoint: { animated: false, currentValue: [200, 100] },
          bounds: { left: 0, top: 0, width: 400, height: 200 }
        })
      ]).proposals[0];
      const unanchored = propose([layer()]).proposals[0];
      expect(anchored!.sourceBounds.left).toBe(unanchored!.sourceBounds.left - 200);
      expect(anchored!.sourceBounds.top).toBe(unanchored!.sourceBounds.top - 100);
    });
  });

  describe("what it refuses, and never guesses at", () => {
    it("refuses a camera before anything else, because a camera has no box to read", () => {
      // Also unreadable in every other way - the camera verdict must win.
      expect(
        onlyRefusal([layer({ isCameraLayer: true, position: null, scale: null, anchorPoint: null, bounds: null })]).reason
      ).toBe("CAMERA_LAYER");
    });

    it("refuses a switched-off layer", () => {
      expect(onlyRefusal([layer({ enabled: false })]).reason).toBe("LAYER_DISABLED");
    });

    it("refuses a layer with no video component", () => {
      expect(onlyRefusal([layer({ hasVideo: false })]).reason).toBe("NO_VIDEO_CONTENT");
    });

    it("refuses a 3D layer rather than applying 2D geometry to it", () => {
      expect(onlyRefusal([layer({ threeDLayer: true })]).reason).toBe("THREE_D_LAYER");
    });

    it("refuses a parented layer rather than moving a child away from its parent", () => {
      expect(onlyRefusal([layer({ parented: true })]).reason).toBe("PARENTED_LAYER");
    });

    it("refuses a keyframed position or scale rather than flattening the animation", () => {
      expect(onlyRefusal([layer({ position: { animated: true, currentValue: [960, 540] } })]).reason).toBe("KEYFRAMED_POSITION_OR_SCALE");
      expect(onlyRefusal([layer({ scale: { animated: true, currentValue: [100, 100] } })]).reason).toBe("KEYFRAMED_POSITION_OR_SCALE");
    });

    it("refuses a non-uniform scale, which one uniform percentage cannot express without distorting the layer", () => {
      expect(onlyRefusal([layer({ scale: { animated: false, currentValue: [100, 50] } })]).reason).toBe("NON_UNIFORM_SOURCE_SCALE");
    });

    it("refuses an unreadable transform, including a property that is not a pair of real numbers", () => {
      expect(onlyRefusal([layer({ position: null })]).reason).toBe("UNREADABLE_TRANSFORM");
      expect(onlyRefusal([layer({ scale: { animated: false, currentValue: 100 } })]).reason).toBe("UNREADABLE_TRANSFORM");
      expect(onlyRefusal([layer({ position: { animated: false, currentValue: [Number.NaN, 540] } })]).reason).toBe("UNREADABLE_TRANSFORM");
    });

    it("refuses a layer with no readable box", () => {
      expect(onlyRefusal([layer({ bounds: null })]).reason).toBe("UNREADABLE_BOUNDS");
      expect(onlyRefusal([layer({ bounds: { left: 0, top: 0, width: 0, height: 200 } })]).reason).toBe("UNREADABLE_BOUNDS");
    });

    it("refuses a zero-scaled or mirrored layer instead of inventing a transform for it", () => {
      expect(onlyRefusal([layer({ scale: { animated: false, currentValue: [0, 0] } })]).reason).toBe("DEGENERATE_GEOMETRY");
      expect(onlyRefusal([layer({ scale: { animated: false, currentValue: [-100, -100] } })]).reason).toBe("DEGENERATE_GEOMETRY");
    });

    it("refuses - rather than assumes - when an older worker did not measure parenting or video component at all", () => {
      expect(onlyRefusal([layer({ hasVideo: null })]).reason).toBe("GEOMETRY_NOT_MEASURED");
      expect(onlyRefusal([layer({ parented: null })]).reason).toBe("GEOMETRY_NOT_MEASURED");
      // Absent is treated exactly as null, never as "false".
      const { hasVideo: _dropped, ...withoutHasVideo } = layer();
      expect(onlyRefusal([withoutHasVideo as MeasuredLayerGeometry]).reason).toBe("GEOMETRY_NOT_MEASURED");
    });

    it("fails closed when the frame it was asked to adapt was never really measured", () => {
      for (const frame of [{ widthPx: 0, heightPx: 1080 }, { widthPx: 1920, heightPx: -1 }, { widthPx: Number.NaN, heightPx: 1080 }]) {
        expect(proposeOutputLayout({ sourceFrame: frame, targetFrame: TARGET, layers: [layer()] }).ok).toBe(false);
      }
      expect(proposeOutputLayout({ sourceFrame: SOURCE, targetFrame: { widthPx: 1080, heightPx: 0 }, layers: [layer()] }).ok).toBe(false);
    });

    it("gives every refusal a reason a human can read, and only reasons the schema knows", () => {
      const proposal = propose([
        layer({ layerIndex: 1, isCameraLayer: true }),
        layer({ layerIndex: 2, enabled: false }),
        layer({ layerIndex: 3, threeDLayer: true }),
        layer({ layerIndex: 4, parented: true })
      ]);
      for (const refusal of proposal.refusals) {
        expect(OUTPUT_LAYOUT_REFUSAL_REASONS).toContain(refusal.reason);
        expect(refusal.detail.length).toBeGreaterThan(0);
      }
    });
  });

  describe("what it promises about the whole set", () => {
    it("accounts for EVERY layer exactly once - nothing is silently dropped", () => {
      const layers = [
        layer({ layerIndex: 1 }),
        layer({ layerIndex: 2, isCameraLayer: true }),
        fullFrameLayer({ layerIndex: 3 }),
        layer({ layerIndex: 4, threeDLayer: true }),
        layer({ layerIndex: 5, position: { animated: true, currentValue: [1, 2] } })
      ];
      const proposal = propose(layers);
      const seen = [...proposal.proposals.map((e) => e.layerIndex), ...proposal.refusals.map((e) => e.layerIndex)].sort();
      expect(seen).toEqual([1, 2, 3, 4, 5]);
    });

    it("returns a proposal the schema accepts, recording the frames and threshold it was computed under", () => {
      const proposal = propose([layer(), fullFrameLayer({ layerIndex: 2 }), layer({ layerIndex: 3, threeDLayer: true })]);
      expect(() => outputLayoutProposalSchema.parse(proposal)).not.toThrow();
      expect(proposal.sourceFrame).toEqual(SOURCE);
      expect(proposal.targetFrame).toEqual(TARGET);
      expect(proposal.backgroundCoverageRatio).toBe(BACKGROUND_COVERAGE_RATIO);
    });

    it("is honest about a composition it cannot help with at all - an empty proposal, not a failure", () => {
      const proposal = propose([layer({ layerIndex: 1, threeDLayer: true }), layer({ layerIndex: 2, parented: true })]);
      expect(proposal.proposals).toHaveLength(0);
      expect(proposal.refusals).toHaveLength(2);
    });

    it("serves any target frame, not just the Reels one - the rule carries no output size of its own", () => {
      const square: OutputFrame = { widthPx: 1000, heightPx: 1000 };
      const [entry] = propose([fullFrameLayer()], SOURCE, square).proposals;
      expect(entry!.proposedBounds.left + entry!.proposedBounds.width).toBeGreaterThanOrEqual(square.widthPx);
      expect(entry!.proposedBounds.top + entry!.proposedBounds.height).toBeGreaterThanOrEqual(square.heightPx);
    });

    it("decides nothing from a layer's NAME - identical geometry under opposite names gets identical numbers", () => {
      const asBackground = propose([fullFrameLayer({ layerName: "content text headline" })]).proposals[0];
      const asContent = propose([fullFrameLayer({ layerName: "BACKGROUND" })]).proposals[0];
      expect(asBackground!.role).toBe("BACKGROUND");
      expect(asContent!.role).toBe("BACKGROUND");
      expect(asBackground!.positionX).toBe(asContent!.positionX);
      expect(asBackground!.positionY).toBe(asContent!.positionY);
      expect(asBackground!.scalePercent).toBe(asContent!.scalePercent);
    });

    it("reports the box the PROPOSED numbers really produce, so the reviewer is not shown a pre-rounding ideal", () => {
      const [entry] = propose([layer({ scale: { animated: false, currentValue: [37, 37] } })]).proposals;
      const factor = entry!.scalePercent / 100;
      // proposedBounds must be re-derivable from the three numbers the
      // reviewer can see and retype - nothing else.
      expect(entry!.proposedBounds.width).toBeCloseTo(400 * factor, 3);
      expect(entry!.proposedBounds.height).toBeCloseTo(200 * factor, 3);
      expect(entry!.proposedBounds.left).toBeCloseTo(entry!.positionX, 3);
      expect(entry!.proposedBounds.top).toBeCloseTo(entry!.positionY, 3);
    });
  });
});
