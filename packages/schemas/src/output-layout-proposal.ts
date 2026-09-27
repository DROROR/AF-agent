import { z } from "zod";

/**
 * THE MEASURED LAYOUT PROPOSAL (real 2026-09-27 incident).
 *
 * Native 1080x1920 Reels output works end to end, but until today the
 * LAYOUT itself had to be typed in by hand, layer by layer, with no help
 * of any kind (ReelsLayoutCard's own doc comment: "Nothing here measures,
 * calculates, suggests or pre-fills a coordinate"). A human producing one
 * by hand for a real template got it wrong twice, in the two ways plain
 * arithmetic always gets it wrong:
 *
 *   1. Every layer's POSITION was mapped into the new frame but
 *      `scalePercent` was left alone, so 1920-wide artwork stayed 1920
 *      wide inside a 1080-wide frame - the headline and the logo were
 *      sliced off at both edges.
 *   2. Everything was then scaled by 1080/1920 to fit the width. Nothing
 *      was cropped any more, but the BACKGROUND shrank with everything
 *      else and the top 38% of the video came out plain black.
 *
 * Both failures have the same cause: a background layer and a content
 * layer need OPPOSITE treatment, and which is which is a fact about
 * measured geometry, not something a person should have to work out per
 * template, per layer, in their head. The operator's instruction was
 * explicit - every template is different, so the system detects this
 * itself.
 *
 * The rule below is the SAME structural rule
 * buildBuildHorizontalCompositionScript (apps/worker, jsx-templates.ts)
 * already uses to produce real, rendering Landscape output from any
 * template, restated here in TypeScript so it can be computed from
 * measured facts OUTSIDE After Effects and shown to a human BEFORE
 * anything is executed:
 *
 *   - Each layer's real bounding box in its source composition's own
 *     coordinate space comes from AE's own `sourceRectAtTime(0, false)`
 *     plus the standard transform formula: `compLeft = position.x -
 *     (anchorPoint.x - sourceRect.left) * scale.x/100` (same for Y).
 *   - A layer whose box covers at least BACKGROUND_COVERAGE_RATIO of BOTH
 *     dimensions of the source frame is a background/full-frame design
 *     layer, and is scaled to COVER the target frame (failure 2 above).
 *   - Every other layer keeps its own real pixel scale - preserving the
 *     template's visual hierarchy - is shrunk uniformly only if it would
 *     not otherwise fit, is moved to the same PROPORTIONAL centre in the
 *     target frame, and is clamped so its box never leaves that frame
 *     (failure 1 above).
 *   - A layer the rule cannot safely adapt is REFUSED, with the reason,
 *     and never silently dropped or guessed at: keyframed position/scale
 *     (a single static transform would destroy that animation), a 3D
 *     layer (this 2D math does not apply), a parented layer (correct
 *     adaptation needs the full parent chain), a camera, a layer whose
 *     geometry the worker's scan did not report, and a layer whose
 *     current scale is non-uniform or degenerate (see
 *     NON_UNIFORM_SOURCE_SCALE below).
 *
 * WHAT THIS IS NOT. This is a PROPOSAL. Nothing here is ever executed as
 * it stands: `layerTransformSchema`'s own doc comment
 * (execute-scene-edit.ts) requires the values BUILD_REELS_COMPOSITION
 * applies to come from human-reviewed persisted intent, and CLAUDE.md's
 * Runtime AI rule requires deterministic code - not a model, and not an
 * execution-time guess - to control what actually happens to a project.
 * So this module computes numbers from measured geometry only, hands them
 * to the approval surface as a starting point a human reviews, edits and
 * approves, and has no path of its own into execution. The worker's
 * BUILD_REELS_COMPOSITION still applies ONLY the `layerTransforms`
 * persisted on the approved plan.
 *
 * NOTHING HERE MAY EVER LOOK AT A LAYER'S NAME. `layerName` is carried
 * through for display in the approval UI and in refusal messages, and is
 * never read by any decision in this file - the same discipline the
 * manifest/mapping code already holds to (a name is a human label, not
 * evidence).
 */

/**
 * The fixed native Reels frame. Not a template-derived number and never
 * read from one: CLAUDE.md requires a true native 1080x1920 Reels output,
 * and the worker's own BUILD_REELS_COMPOSITION JSX resizes the duplicate
 * to exactly this and accepts no caller-supplied dimension.
 */
export const REELS_OUTPUT_WIDTH_PX = 1080;
export const REELS_OUTPUT_HEIGHT_PX = 1920;

/**
 * A layer covering at least this fraction of BOTH source dimensions is
 * treated as a background/full-frame design layer. Deliberately the SAME
 * 0.85 constant buildBuildHorizontalCompositionScript already uses in
 * production: one rule, one threshold, both orientations. It is a
 * proportion, never a pixel count, so it carries no template's
 * dimensions with it.
 */
export const BACKGROUND_COVERAGE_RATIO = 0.85;

/** Proposed numbers are rounded to this many decimals - a coordinate a reviewer has to read and may retype, not a float artefact. Sub-thousandth-of-a-pixel precision has no meaning in an AE transform. */
const PROPOSAL_DECIMALS = 3;

function round(value: number): number {
  const factor = 10 ** PROPOSAL_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Rounding a scale has a SAFE DIRECTION, and it is not the same one for
 * the two roles. A background rounded down stops covering - the same
 * class of defect as the black band the 2026-09-27 run produced, just a
 * few thousandths of a pixel of it - so a cover scale is always rounded
 * UP. A content layer rounded up stops fitting, so a fit scale is always
 * rounded DOWN. Neither ever relies on a tolerance somewhere else to
 * absorb it.
 */
function roundUp(value: number): number {
  const factor = 10 ** PROPOSAL_DECIMALS;
  return Math.ceil(value * factor) / factor;
}

function roundDown(value: number): number {
  const factor = 10 ** PROPOSAL_DECIMALS;
  return Math.floor(value * factor) / factor;
}

/** A layer's own untransformed bounds exactly as AE's `sourceRectAtTime(time, false)` reports them - never re-shaped, never inferred. */
export const layerBoundsSchema = z
  .object({
    left: z.number(),
    top: z.number(),
    width: z.number(),
    height: z.number()
  })
  .strict();
export type LayerBounds = z.infer<typeof layerBoundsSchema>;

/** A composition frame in pixels - the source composition's real measured size, or the fixed target output size. */
export const outputFrameSchema = z
  .object({
    widthPx: z.number().positive(),
    heightPx: z.number().positive()
  })
  .strict();
export type OutputFrame = z.infer<typeof outputFrameSchema>;

/**
 * BACKGROUND: the layer's measured box covers the source frame, so it is
 * scaled to cover the target frame. CONTENT: everything else - real pixel
 * scale preserved, only shrunk to fit. A measured verdict about one
 * layer's geometry, shown to the reviewer so the proposed numbers can be
 * understood rather than merely accepted.
 */
export const OUTPUT_LAYOUT_LAYER_ROLES = ["BACKGROUND", "CONTENT"] as const;
export type OutputLayoutLayerRole = (typeof OUTPUT_LAYOUT_LAYER_ROLES)[number];

export const outputLayoutProposalEntrySchema = z
  .object({
    layerIndex: z.number().int().positive(),
    /** Display only - carried for the approval UI and never read by any decision in this module. */
    layerName: z.string(),
    role: z.enum(OUTPUT_LAYOUT_LAYER_ROLES),
    /** Exactly the three values layerTransformSchema carries, in the target frame's own pixel coordinates. */
    positionX: z.number(),
    positionY: z.number(),
    scalePercent: z.number().positive(),
    /** The layer's measured box in the SOURCE composition's own coordinates - the evidence the proposal was derived from. */
    sourceBounds: layerBoundsSchema,
    /** Where that box lands in the TARGET frame if these exact proposed numbers are applied - derived from the rounded values, so it is what the reviewer would really get, not an idealised pre-rounding figure. */
    proposedBounds: layerBoundsSchema
  })
  .strict();
export type OutputLayoutProposalEntry = z.infer<typeof outputLayoutProposalEntrySchema>;

/**
 * Why one layer got no proposal. Reported, never omitted: a layer that
 * silently disappeared from the proposal would leave the reviewer to
 * discover the gap either by eye in the finished video or as a failed
 * job hours later.
 */
export const OUTPUT_LAYOUT_REFUSAL_REASONS = [
  /** Position or scale carries real keyframes - a single static transform would destroy that animation (the same refusal both build scripts already make). */
  "KEYFRAMED_POSITION_OR_SCALE",
  /** A 3D layer: this rule's 2D geometry does not apply safely to a 3D transform. */
  "THREE_D_LAYER",
  /** Parented to another layer: correct adaptation needs the full parent-chain transform, which this rule does not attempt. */
  "PARENTED_LAYER",
  /** A camera has no 2D bounding box and no scale to adapt. */
  "CAMERA_LAYER",
  /** Switched off in the template - nothing to adapt (the build script skips it too). */
  "LAYER_DISABLED",
  /** No video component (an audio-only or guide-type layer) - nothing to adapt. */
  "NO_VIDEO_CONTENT",
  /** The scan that produced these facts did not report the geometry this rule needs (an older worker) - re-read the layers to get a proposal. */
  "GEOMETRY_NOT_MEASURED",
  /** Position, scale or anchor point could not be read as real numbers. */
  "UNREADABLE_TRANSFORM",
  /** No readable bounding box. */
  "UNREADABLE_BOUNDS",
  /** The layer's current scale differs between X and Y, and layerTransformSchema carries ONE uniform scalePercent - any single value would silently change the layer's aspect ratio. */
  "NON_UNIFORM_SOURCE_SCALE",
  /** Zero, negative (mirrored) or vanishingly small effective size - there is no honest single transform for it. */
  "DEGENERATE_GEOMETRY"
] as const;
export type OutputLayoutRefusalReason = (typeof OUTPUT_LAYOUT_REFUSAL_REASONS)[number];

export const outputLayoutRefusalSchema = z
  .object({
    layerIndex: z.number().int().positive(),
    /** Display only - so the reviewer can find the layer in After Effects. Never read by any decision. */
    layerName: z.string(),
    reason: z.enum(OUTPUT_LAYOUT_REFUSAL_REASONS),
    /** A plain sentence for the person reading it - never a substitute for `reason`, which is what code branches on. */
    detail: z.string().min(1)
  })
  .strict();
export type OutputLayoutRefusal = z.infer<typeof outputLayoutRefusalSchema>;

export const outputLayoutProposalSchema = z
  .object({
    /** The source composition's REAL measured frame, as the scan read it - never assumed from the template. */
    sourceFrame: outputFrameSchema,
    targetFrame: outputFrameSchema,
    /** Recorded with the proposal so a stored one can always be re-derived and audited under the threshold it was actually computed with. */
    backgroundCoverageRatio: z.number().positive(),
    /** May be empty: a composition of nothing but animated layers is a real, honest "this rule cannot help here", not a failure. */
    proposals: z.array(outputLayoutProposalEntrySchema),
    refusals: z.array(outputLayoutRefusalSchema)
  })
  .strict();
export type OutputLayoutProposal = z.infer<typeof outputLayoutProposalSchema>;

/**
 * One animatable transform property as the layer scan reports it. Kept
 * structural (not imported from scene-evidence.ts) purely so this module
 * stays a leaf with no schema-package import cycle - a real
 * `AnimatablePropertyFact` satisfies it exactly.
 */
export interface MeasuredProperty {
  animated: boolean;
  currentValue: number | number[];
}

/**
 * Everything this rule needs about ONE layer, and nothing else. A real
 * `LayerTransformFact` (scene-evidence.ts) satisfies this shape.
 * `hasVideo`/`parented`/`bounds` are nullable because a worker whose scan
 * predates geometry reporting genuinely does not know them - which is
 * refused as GEOMETRY_NOT_MEASURED, never assumed either way.
 */
export interface MeasuredLayerGeometry {
  layerIndex: number;
  layerName: string;
  enabled: boolean;
  threeDLayer: boolean;
  isCameraLayer: boolean;
  hasVideo?: boolean | null | undefined;
  parented?: boolean | null | undefined;
  position: MeasuredProperty | null;
  scale: MeasuredProperty | null;
  anchorPoint: MeasuredProperty | null;
  bounds?: LayerBounds | null | undefined;
}

/** AE reports position/scale/anchor as a 2- or 3-element array; a property that is not a pair of real numbers is refused rather than coerced. */
function pair(property: MeasuredProperty | null): { x: number; y: number } | null {
  if (property === null || !Array.isArray(property.currentValue) || property.currentValue.length < 2) {
    return null;
  }
  const [x, y] = property.currentValue;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * The whole rule, as one pure function: measured geometry in, a proposal
 * a human reviews out. No I/O, no clock, no randomness, no layer names in
 * any decision, no template-specific dimension or coordinate anywhere -
 * the source frame is measured and the target frame is supplied, so the
 * same code serves the 1080x1920 Reels frame and any other target.
 *
 * Fails closed with a reason rather than returning a proposal it cannot
 * stand behind (a frame whose measured size is not a real positive
 * number means the scan itself did not produce usable evidence).
 */
export function proposeOutputLayout(input: {
  sourceFrame: OutputFrame;
  targetFrame: OutputFrame;
  layers: readonly MeasuredLayerGeometry[];
}): { ok: true; proposal: OutputLayoutProposal } | { ok: false; reason: string } {
  const { sourceFrame, targetFrame } = input;
  if (!isPositiveFinite(sourceFrame.widthPx) || !isPositiveFinite(sourceFrame.heightPx)) {
    return { ok: false, reason: "the source composition's own frame size was not measured as a real positive size - no layout can be derived from it" };
  }
  if (!isPositiveFinite(targetFrame.widthPx) || !isPositiveFinite(targetFrame.heightPx)) {
    return { ok: false, reason: "the target frame size is not a real positive size" };
  }

  const proposals: OutputLayoutProposalEntry[] = [];
  const refusals: OutputLayoutRefusal[] = [];
  const refuse = (layer: MeasuredLayerGeometry, reason: OutputLayoutRefusalReason, detail: string): void => {
    refusals.push({ layerIndex: layer.layerIndex, layerName: layer.layerName, reason, detail });
  };

  for (const layer of input.layers) {
    if (layer.isCameraLayer) {
      refuse(layer, "CAMERA_LAYER", "a camera has no 2D bounding box and no scale, so there is nothing this geometry rule can reposition");
      continue;
    }
    if (!layer.enabled) {
      refuse(layer, "LAYER_DISABLED", "the layer is switched off in the template, so there is nothing to adapt");
      continue;
    }
    const hasVideo = layer.hasVideo ?? null;
    const parented = layer.parented ?? null;
    const measuredBounds = layer.bounds ?? null;
    if (hasVideo === false) {
      refuse(layer, "NO_VIDEO_CONTENT", "the layer has no video component (audio-only or guide), so there is nothing to adapt");
      continue;
    }
    if (hasVideo === null || parented === null) {
      refuse(
        layer,
        "GEOMETRY_NOT_MEASURED",
        "the layer scan that produced these facts did not report this layer's parenting or video component - read the layers again to get a proposal for it"
      );
      continue;
    }
    if (layer.threeDLayer) {
      refuse(layer, "THREE_D_LAYER", "the layer is a 3D layer, and this rule's 2D geometry does not apply safely to a 3D transform");
      continue;
    }
    if (parented) {
      refuse(
        layer,
        "PARENTED_LAYER",
        "the layer is parented to another layer - adapting it correctly needs the full parent-chain transform, and moving it alone while its parent stays put would silently place it wrongly"
      );
      continue;
    }
    if (layer.position === null || layer.scale === null || layer.anchorPoint === null) {
      refuse(layer, "UNREADABLE_TRANSFORM", "the layer's position, scale or anchor point could not be read at all");
      continue;
    }
    if (layer.position.animated || layer.scale.animated) {
      refuse(
        layer,
        "KEYFRAMED_POSITION_OR_SCALE",
        "the layer's position or scale is keyframed - writing one static transform over it would destroy that animation, so it is left exactly as the template has it"
      );
      continue;
    }

    const position = pair(layer.position);
    const scale = pair(layer.scale);
    const anchor = pair(layer.anchorPoint);
    if (position === null || scale === null || anchor === null) {
      refuse(layer, "UNREADABLE_TRANSFORM", "the layer's position, scale or anchor point was not reported as a pair of real numbers");
      continue;
    }
    if (scale.x !== scale.y) {
      refuse(
        layer,
        "NON_UNIFORM_SOURCE_SCALE",
        "the layer is scaled differently on X and Y, and an approved layer transform carries a single uniform scale percentage - any one value would silently change this layer's aspect ratio"
      );
      continue;
    }
    if (measuredBounds === null || !isPositiveFinite(measuredBounds.width) || !isPositiveFinite(measuredBounds.height)) {
      refuse(layer, "UNREADABLE_BOUNDS", "the layer has no readable bounding box, so its real size in the frame is unknown");
      continue;
    }
    const bounds = measuredBounds;

    const scaleFactor = scale.x / 100;
    const boxWidth = bounds.width * scaleFactor;
    const boxHeight = bounds.height * scaleFactor;
    if (!isPositiveFinite(boxWidth) || !isPositiveFinite(boxHeight)) {
      refuse(
        layer,
        "DEGENERATE_GEOMETRY",
        "the layer's current scale gives it no positive size on screen (a zero-scaled or mirrored layer), so there is no honest single transform for it"
      );
      continue;
    }

    // The standard AE transform formula, identical to the one
    // buildBuildHorizontalCompositionScript applies inside AE.
    const boxLeft = position.x - (anchor.x - bounds.left) * scaleFactor;
    const boxTop = position.y - (anchor.y - bounds.top) * scaleFactor;

    const isBackground = boxWidth >= BACKGROUND_COVERAGE_RATIO * sourceFrame.widthPx && boxHeight >= BACKGROUND_COVERAGE_RATIO * sourceFrame.heightPx;

    let factor: number;
    let newLeft: number;
    let newTop: number;
    if (isBackground) {
      /*
       * COVER, and deliberately UNIFORM - the one place this differs from
       * the Landscape script, which stretches a background non-uniformly
       * to fill its new frame. Two reasons, both structural rather than
       * stylistic: an approved layer transform carries a single uniform
       * `scalePercent` (layerTransformSchema) and physically cannot
       * express a non-uniform scale; and the Reels change of aspect is
       * severe (a 16:9 background stretched to 9:16 is distorted roughly
       * three and a half times over), which is not something to propose
       * to a human as a default. Covering overflows the frame on one axis
       * instead - which is exactly what a background is for, and is what
       * closes the "top 38% of the video is plain black" failure.
       */
      factor = Math.max(targetFrame.widthPx / boxWidth, targetFrame.heightPx / boxHeight);
      newLeft = (targetFrame.widthPx - boxWidth * factor) / 2;
      newTop = (targetFrame.heightPx - boxHeight * factor) / 2;
    } else {
      // Keeps its own real pixel scale; only ever shrunk, never enlarged.
      factor = Math.min(1, targetFrame.widthPx / boxWidth, targetFrame.heightPx / boxHeight);
      const newWidth = boxWidth * factor;
      const newHeight = boxHeight * factor;
      // Same PROPORTIONAL centre in the target frame, then clamped so the
      // box never leaves that frame - the "sliced off at both edges"
      // failure.
      let centreX = ((boxLeft + boxWidth / 2) / sourceFrame.widthPx) * targetFrame.widthPx;
      let centreY = ((boxTop + boxHeight / 2) / sourceFrame.heightPx) * targetFrame.heightPx;
      centreX = Math.min(Math.max(centreX, newWidth / 2), targetFrame.widthPx - newWidth / 2);
      centreY = Math.min(Math.max(centreY, newHeight / 2), targetFrame.heightPx - newHeight / 2);
      newLeft = centreX - newWidth / 2;
      newTop = centreY - newHeight / 2;
    }

    const proposedScalePercent = isBackground ? roundUp(scale.x * factor) : roundDown(scale.x * factor);
    if (!isPositiveFinite(proposedScalePercent)) {
      refuse(layer, "DEGENERATE_GEOMETRY", "adapting this layer to the target frame would need a scale of effectively zero, which is never proposed");
      continue;
    }
    const proposedScaleFactor = proposedScalePercent / 100;
    const positionX = round(newLeft + (anchor.x - bounds.left) * proposedScaleFactor);
    const positionY = round(newTop + (anchor.y - bounds.top) * proposedScaleFactor);

    proposals.push({
      layerIndex: layer.layerIndex,
      layerName: layer.layerName,
      role: isBackground ? "BACKGROUND" : "CONTENT",
      positionX,
      positionY,
      scalePercent: proposedScalePercent,
      sourceBounds: { left: round(boxLeft), top: round(boxTop), width: round(boxWidth), height: round(boxHeight) },
      // Derived from the ROUNDED values actually being proposed, so what
      // the reviewer is shown is what applying them really produces.
      proposedBounds: {
        left: round(positionX - (anchor.x - bounds.left) * proposedScaleFactor),
        top: round(positionY - (anchor.y - bounds.top) * proposedScaleFactor),
        width: round(bounds.width * proposedScaleFactor),
        height: round(bounds.height * proposedScaleFactor)
      }
    });
  }

  return {
    ok: true,
    proposal: {
      sourceFrame: { widthPx: sourceFrame.widthPx, heightPx: sourceFrame.heightPx },
      targetFrame: { widthPx: targetFrame.widthPx, heightPx: targetFrame.heightPx },
      backgroundCoverageRatio: BACKGROUND_COVERAGE_RATIO,
      proposals,
      refusals
    }
  };
}
