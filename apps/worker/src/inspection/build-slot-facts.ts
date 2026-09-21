import type { MatteSource, SlotHostFacts, SlotStructuralFacts } from "@dyo/schemas";
import type { CompositionFact } from "./project-facts.js";

/**
 * The minimal shape of one scanned layer this module reads - deliberately
 * narrower than the full scan record, so it can be fed from either the parsed
 * scan or a synthetic fixture without dragging the whole scan schema along.
 */
export interface ScannedSlotLayer {
  kind?: string | undefined;
  /** AE's own switch for this layer. False means nothing it contains renders at all. */
  enabled?: boolean | undefined;
  footage?: { hasVideo?: boolean; isStill?: boolean; isSolid?: boolean; widthPx?: number | null; heightPx?: number | null } | null | undefined;
  detail?:
    | {
        hasTrackMatte?: boolean | null | undefined;
        trackMatteType?: string | null | undefined;
        trackMatteLayerIndex?: number | null | undefined;
        threeDLayer?: boolean | null | undefined;
        parentLayerIndex?: number | null | undefined;
        hasTransformKeyframes?: boolean | null | undefined;
        inPointSeconds?: number | null | undefined;
        outPointSeconds?: number | null | undefined;
        scalePercent?: number | null | undefined;
        scalePercentY?: number | null | undefined;
        rotationDegrees?: number | null | undefined;
        /** Effective-visibility facts (2026-09-21). Unread stays undefined - unknown, never false. */
        opacityAtInPoint?: number | null | undefined;
        opacityKeyframes?: readonly { timeSeconds: number; valuePercent: number }[] | null | undefined;
        positionX?: number | null | undefined;
        positionY?: number | null | undefined;
        anchorX?: number | null | undefined;
        anchorY?: number | null | undefined;
      }
    | null
    | undefined;
}

/**
 * ASSEMBLING ONE SLOT'S STRUCTURAL FACTS (Stage 4, 2026-09-19).
 *
 * The classifier in `@dyo/schemas` decides what a slot IS; this decides what
 * is true about it. Everything here comes from the composition graph and the
 * project-wide scan - which layers pull this slot's composition in, what their
 * mattes are made of, whether they are 3D, whether their parents are animated,
 * and what a pre-rendered pass beside them implies.
 *
 * WHAT IT NEVER DOES: read a name to decide a fact. Names are carried through
 * for display and weak evidence only (see slot-semantics.ts).
 *
 * WHAT AN UNREADABLE FACT MEANS: `null`/`UNKNOWN`, never `false`. A scan from
 * an older worker build, or a layer AE would not report, must lower confidence
 * - which blocks and asks a human - rather than silently arguing for one side.
 */

export interface SlotFactsInput {
  /** The composition holding the slot layer itself. */
  slotComposition: CompositionFact;
  /** The slot layer's own index and name within that composition. */
  slotLayerIndex: number;
  slotLayerName: string | null;
  /** Every composition in the project, so hosts can be found wherever they are. */
  compositions: readonly CompositionFact[];
  /** The project-wide scan, keyed `comp-<id>:<layerIndex>` - the same map build-project-facts.ts already uses. */
  layerFactsByCompositionAndIndex: ReadonlyMap<string, ScannedSlotLayer> | undefined;
  /** How many precomp hops separate this slot from the scene being planned. */
  hostDepth: number;
  /**
   * True when the slot IS a whole composition placed by other layers (a screen
   * card: the window's structure lives entirely in the layers that pull that
   * composition in). False when the slot is a footage layer that carries its
   * OWN matte, 3D state and parent - then that layer's own facts are part of
   * the structure, not only its composition's placements.
   */
  slotIsWholeComposition: boolean;
}

/** The scanned layer facts for one layer, or undefined when the scan has no entry for it. */
function scannedLayer(input: SlotFactsInput, compositionId: string, layerIndex: number): ScannedSlotLayer | undefined {
  return input.layerFactsByCompositionAndIndex?.get(`${compositionId}:${layerIndex}`);
}

/**
 * What a host layer's track matte is made OF - the strongest single signal,
 * and the reason matte presence alone proves nothing.
 *
 * A matte whose own source is rendered footage is a designer's rendered
 * hardware pass (so the window it cuts is a device screen); a matte that is a
 * solid, a shape or a drawn mask is a rectangle the designer drew (so it is a
 * flat card). Anything unreadable is UNKNOWN, never assumed.
 */
export function classifyMatteSource(input: SlotFactsInput, compositionId: string, host: ScannedSlotLayer | undefined, hostLayerIndex: number): MatteSource {
  const detail = host?.detail;
  if (!detail || detail.hasTrackMatte !== true) {
    return detail?.hasTrackMatte === false ? "NONE" : "UNKNOWN";
  }
  // AE reports the matte layer explicitly on newer builds; on older ones the
  // matte is by definition the layer directly above.
  const matteIndex = detail.trackMatteLayerIndex ?? hostLayerIndex - 1;
  if (matteIndex === null) {
    return "UNKNOWN";
  }
  const matteLayer = scannedLayer(input, compositionId, matteIndex);
  if (!matteLayer) {
    return "UNKNOWN";
  }
  const footage = matteLayer.footage;
  if (footage && footage.isSolid) {
    return "DRAWN_MASK_OR_SOLID";
  }
  if (footage && footage.hasVideo) {
    return "RENDERED_FOOTAGE";
  }
  if (matteLayer.kind === "ShapeLayer" || matteLayer.kind === "TextLayer") {
    return "DRAWN_MASK_OR_SOLID";
  }
  if (footage && footage.isStill) {
    // A still image used as a matte is a drawn/authored shape, not a render
    // of moving hardware.
    return "DRAWN_MASK_OR_SOLID";
  }
  return "UNKNOWN";
}

/**
 * True when a sibling layer in the same composition is a pre-rendered pass
 * covering this region - the "beauty pass" that IS the device hardware.
 *
 * Mirrors build-manifest.ts's own isPreRenderedPass rule: video footage cut by
 * a matte that is itself video footage is one render split into passes.
 */
function hasSiblingPreRenderedPass(input: SlotFactsInput, compositionId: string, hostLayerIndex: number, composition: CompositionFact | undefined): boolean | null {
  if (!composition || input.layerFactsByCompositionAndIndex === undefined) {
    return null;
  }
  let sawAnyScannedSibling = false;
  for (const layer of composition.layers) {
    if (layer.index === hostLayerIndex) {
      continue;
    }
    const scanned = scannedLayer(input, compositionId, layer.index);
    if (!scanned?.detail) {
      continue;
    }
    sawAnyScannedSibling = true;
    const isVideo = scanned.footage?.hasVideo === true;
    const matteSource = classifyMatteSource(input, compositionId, scanned, layer.index);
    if (isVideo && matteSource === "RENDERED_FOOTAGE") {
      return true;
    }
  }
  return sawAnyScannedSibling ? false : null;
}

/**
 * Whether a host's rendered rectangle reaches its composition's frame at all.
 *
 * A slot parked far outside the frame is not on screen no matter what its
 * in/out points say, and an evidence frame taken then shows an empty canvas.
 * Computed from position, anchor and scale against the composition's own size;
 * null - unknown, never false - the moment any of those is unread, and for a 3D
 * layer, whose on-screen position depends on a camera this scan does not read.
 */
function computeInFrame(
  detail: NonNullable<ScannedSlotLayer["detail"]>,
  composition: CompositionFact | undefined,
  contentWidthPx: number | null,
  contentHeightPx: number | null
): boolean | null {
  if (!composition || composition.widthPx === null || composition.heightPx === null || detail.threeDLayer === true) {
    return null;
  }
  const { positionX, positionY, anchorX, anchorY, scalePercent } = detail;
  const scaleY = detail.scalePercentY ?? scalePercent;
  if (
    typeof positionX !== "number" ||
    typeof positionY !== "number" ||
    typeof anchorX !== "number" ||
    typeof anchorY !== "number" ||
    typeof scalePercent !== "number" ||
    typeof scaleY !== "number" ||
    contentWidthPx === null ||
    contentHeightPx === null
  ) {
    return null;
  }
  const renderedWidth = (contentWidthPx * scalePercent) / 100;
  const renderedHeight = (contentHeightPx * scaleY) / 100;
  const left = positionX - (anchorX * scalePercent) / 100;
  const top = positionY - (anchorY * scaleY) / 100;
  return left < composition.widthPx && top < composition.heightPx && left + renderedWidth > 0 && top + renderedHeight > 0;
}

/**
 * The facts that decide whether a host is EFFECTIVELY visible, and when: its
 * own switch, its in/out window, its opacity over time, and whether its
 * rectangle reaches the frame. Every one is null when the scan did not read it,
 * so an older worker build lowers certainty instead of hiding a slot.
 */
function visibilityFacts(
  scanned: ScannedSlotLayer | undefined,
  detail: ScannedSlotLayer["detail"],
  composition: CompositionFact | undefined,
  contentWidthPx: number | null,
  contentHeightPx: number | null
): Pick<SlotHostFacts, "enabled" | "windowSeconds" | "opacityPercentAtInPoint" | "opacityKeyframes" | "inFrame"> {
  const start = detail?.inPointSeconds;
  const end = detail?.outPointSeconds;
  return {
    enabled: typeof scanned?.enabled === "boolean" ? scanned.enabled : null,
    windowSeconds: typeof start === "number" && typeof end === "number" && end > start ? { startSeconds: start, endSeconds: end } : null,
    opacityPercentAtInPoint: detail?.opacityAtInPoint ?? null,
    opacityKeyframes: detail?.opacityKeyframes ? detail.opacityKeyframes.map((keyframe) => ({ ...keyframe })) : null,
    inFrame: detail ? computeInFrame(detail, composition, contentWidthPx, contentHeightPx) : null
  };
}

/** Assembles the full structural picture of one slot, including every host that pulls it in. *//** Assembles the full structural picture of one slot, including every host that pulls it in. *//** Assembles the full structural picture of one slot, including every host that pulls it in. */
export function buildSlotStructuralFacts(input: SlotFactsInput): SlotStructuralFacts {
  const compositionById = new Map(input.compositions.map((composition) => [composition.compositionId, composition]));
  const slotLayer = input.slotComposition.layers.find((layer) => layer.index === input.slotLayerIndex);

  const hosts: SlotHostFacts[] = [];
  // How many DISTINCT placements pull this slot's composition in - the self
  // entry below is the slot itself, not a placement of it, so it is not
  // counted as reuse.
  let precompHostCount = 0;

  // A footage layer's own matte/3D/parent facts ARE its structure: a top-level
  // image layer has no precomp host at all, and judging it only by how its
  // composition is placed would leave every such slot unclassifiable.
  if (!input.slotIsWholeComposition) {
    const scannedSelf = scannedLayer(input, input.slotComposition.compositionId, input.slotLayerIndex);
    const selfDetail = scannedSelf?.detail;
    const selfParentIndex = selfDetail?.parentLayerIndex ?? null;
    const selfParentScanned = selfParentIndex === null ? undefined : scannedLayer(input, input.slotComposition.compositionId, selfParentIndex);
    hosts.push({
      compositionId: input.slotComposition.compositionId,
      layerIndex: input.slotLayerIndex,
      layerName: input.slotLayerName,
      threeDLayer: selfDetail?.threeDLayer ?? null,
      hasTrackMatte: selfDetail?.hasTrackMatte ?? null,
      trackMatteType: selfDetail?.trackMatteType ?? null,
      matteSource: classifyMatteSource(input, input.slotComposition.compositionId, scannedSelf, input.slotLayerIndex),
      parentLayerIndex: selfParentIndex,
      parentIsAnimated: selfParentIndex === null ? null : (selfParentScanned?.detail?.hasTransformKeyframes ?? null),
      siblingPreRenderedPass: hasSiblingPreRenderedPass(input, input.slotComposition.compositionId, input.slotLayerIndex, input.slotComposition),
      scalePercent: selfDetail?.scalePercent ?? null,
      rotationDegrees: selfDetail?.rotationDegrees ?? null,
      ...visibilityFacts(scannedSelf, selfDetail, input.slotComposition, slotLayer?.footage?.widthPx ?? input.slotComposition.widthPx, slotLayer?.footage?.heightPx ?? input.slotComposition.heightPx)
    });
  }

  // Placements, in a fixed order. The project's own composition/edge order is
  // an artefact of how the scan happened to walk the file, and a fingerprint
  // that changed with it would fail closed on a project nobody touched.
  const placements: SlotHostFacts[] = [];
  for (const composition of input.compositions) {
    for (const child of composition.precompChildren) {
      if (child.sourceCompositionId !== input.slotComposition.compositionId) {
        continue;
      }
      precompHostCount += 1;
      const scanned = scannedLayer(input, composition.compositionId, child.layerIndex);
      const detail = scanned?.detail;
      const parentLayerIndex = detail?.parentLayerIndex ?? null;
      const parentScanned = parentLayerIndex === null ? undefined : scannedLayer(input, composition.compositionId, parentLayerIndex);
      placements.push({
        compositionId: composition.compositionId,
        layerIndex: child.layerIndex,
        layerName: child.layerName,
        threeDLayer: detail?.threeDLayer ?? null,
        hasTrackMatte: detail?.hasTrackMatte ?? child.hasTrackMatte ?? null,
        trackMatteType: detail?.trackMatteType ?? null,
        matteSource: classifyMatteSource(input, composition.compositionId, scanned, child.layerIndex),
        parentLayerIndex,
        // Unread parent transform facts stay null: "not known to be animated"
        // must never read as "known to be static".
        parentIsAnimated: parentLayerIndex === null ? null : (parentScanned?.detail?.hasTransformKeyframes ?? null),
        siblingPreRenderedPass: hasSiblingPreRenderedPass(input, composition.compositionId, child.layerIndex, compositionById.get(composition.compositionId)),
        scalePercent: detail?.scalePercent ?? null,
        rotationDegrees: detail?.rotationDegrees ?? null,
        // A host places the WHOLE slot composition, so its rendered size is
        // that composition's own size.
        ...visibilityFacts(scanned, detail, composition, input.slotComposition.widthPx, input.slotComposition.heightPx)
      });
    }
  }

  placements.sort((a, b) => (a.compositionId === b.compositionId ? a.layerIndex - b.layerIndex : a.compositionId < b.compositionId ? -1 : 1));
  hosts.push(...placements);

  const widthPx = slotLayer?.footage?.widthPx ?? input.slotComposition.widthPx;
  const heightPx = slotLayer?.footage?.heightPx ?? input.slotComposition.heightPx;

  // Rendered size in the top-level composition, when every hop's scale is
  // known. One unreadable scale makes the whole product unknown rather than
  // an optimistic guess.
  let transformedBounds: SlotStructuralFacts["transformedBounds"] = null;
  if (widthPx !== null && heightPx !== null && hosts.length > 0) {
    const scales = hosts.map((host) => host.scalePercent);
    if (scales.every((scale): scale is number => typeof scale === "number")) {
      const smallest = Math.min(...scales) / 100;
      if (smallest > 0) {
        transformedBounds = { widthPx: widthPx * smallest, heightPx: heightPx * smallest };
      }
    }
  }

  // The raw window, kept only so a consumer that predates host-level
  // visibility facts still has something to read. The moment an evidence frame
  // is actually taken at comes from computeEffectiveVisibility, which reads the
  // per-host switches, opacity and in-frame bounds recorded above - timing
  // alone never decides it.
  let visibleWindowSeconds: SlotStructuralFacts["visibleWindowSeconds"] = null;
  for (const host of hosts) {
    if (host.enabled === false || host.inFrame === false) {
      continue;
    }
    const start = host.windowSeconds?.startSeconds;
    const end = host.windowSeconds?.endSeconds;
    if (typeof start === "number" && typeof end === "number" && end > start) {
      visibleWindowSeconds = { startSeconds: start, endSeconds: end };
      break;
    }
  }

  return {
    slotCompositionId: input.slotComposition.compositionId,
    slotLayerIndex: input.slotLayerIndex,
    slotLayerName: input.slotLayerName,
    slotCompositionName: input.slotComposition.name,
    widthPx: widthPx && widthPx > 0 ? widthPx : null,
    heightPx: heightPx && heightPx > 0 ? heightPx : null,
    hostDepth: input.hostDepth,
    hosts,
    reusedByHostCount: precompHostCount,
    transformedBounds,
    visibleWindowSeconds
  };
}
