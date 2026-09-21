import { classifySlotSemantics, type Placeholder, type SlotHostFacts, type SlotStructuralFacts } from "@dyo/schemas";

/**
 * SYNTHETIC slot fixtures for the slot-semantics and fit gate (Stage 4).
 *
 * Every shape here is a MECHANISM, not a template: a phone screen is "a window
 * cut by a rendered matte, animated in 3D off a parent", a flat card is "a
 * rectangle cut by a drawn mask, sitting still in 2D". No real template's
 * names, ids, dimensions, timings or hierarchy appear anywhere - the names
 * used are deliberately misleading in some fixtures, to prove they decide
 * nothing.
 */

function hostFixture(overrides: Partial<SlotHostFacts> = {}): SlotHostFacts {
  return {
    compositionId: "host-composition",
    layerIndex: 3,
    layerName: null,
    threeDLayer: false,
    hasTrackMatte: false,
    trackMatteType: null,
    matteSource: "NONE",
    parentLayerIndex: null,
    parentIsAnimated: null,
    siblingPreRenderedPass: null,
    scalePercent: 100,
    rotationDegrees: 0,
    ...overrides
  };
}

export function slotFactsFixture(overrides: Partial<SlotStructuralFacts> = {}): SlotStructuralFacts {
  return {
    slotCompositionId: "slot-composition",
    slotLayerIndex: 1,
    slotLayerName: null,
    slotCompositionName: null,
    widthPx: 1000,
    heightPx: 1000,
    hostDepth: 1,
    hosts: [hostFixture()],
    reusedByHostCount: 1,
    transformedBounds: null,
    visibleWindowSeconds: { startSeconds: 2, endSeconds: 6 },
    ...overrides
  };
}

/** A window cut into a rendered hardware pass, animated in 3D off a moving parent. */
export function deviceScreenSlotFacts(overrides: Partial<SlotStructuralFacts> = {}): SlotStructuralFacts {
  return slotFactsFixture({
    widthPx: 1080,
    heightPx: 2160,
    hosts: [
      hostFixture({
        threeDLayer: true,
        hasTrackMatte: true,
        trackMatteType: "ALPHA",
        matteSource: "RENDERED_FOOTAGE",
        parentLayerIndex: 2,
        parentIsAnimated: true,
        siblingPreRenderedPass: true
      })
    ],
    ...overrides
  });
}

/** A rectangle a designer drew, sitting still in 2D with nothing rendered behind it. */
export function flatCardSlotFacts(overrides: Partial<SlotStructuralFacts> = {}): SlotStructuralFacts {
  return slotFactsFixture({
    widthPx: 1600,
    heightPx: 900,
    hosts: [
      hostFixture({
        threeDLayer: false,
        hasTrackMatte: true,
        trackMatteType: "ALPHA",
        matteSource: "DRAWN_MASK_OR_SOLID",
        parentLayerIndex: null,
        parentIsAnimated: false,
        siblingPreRenderedPass: false
      })
    ],
    ...overrides
  });
}

/** Structure that genuinely argues both ways at once - never silently resolved. */
export function conflictingSlotFacts(overrides: Partial<SlotStructuralFacts> = {}): SlotStructuralFacts {
  return slotFactsFixture({
    widthPx: 1200,
    heightPx: 1200,
    hosts: [
      hostFixture({
        threeDLayer: true,
        hasTrackMatte: true,
        trackMatteType: "LUMA",
        matteSource: "DRAWN_MASK_OR_SOLID",
        parentLayerIndex: 4,
        parentIsAnimated: true,
        siblingPreRenderedPass: false
      })
    ],
    ...overrides
  });
}

/** An image placeholder carrying real Stage 4 slot facts and the verdict they produce. */
export function imagePlaceholderFixture(spec: {
  placeholderId: string;
  compositionId?: string;
  layerName?: string;
  slotFacts?: SlotStructuralFacts | null;
  /** Overrides the computed verdict - used only to model a stale/missing model version. */
  slotSemantics?: Placeholder["slotSemantics"];
}): Placeholder {
  const facts = spec.slotFacts === undefined ? deviceScreenSlotFacts() : spec.slotFacts;
  const semantics = spec.slotSemantics ?? (facts === null ? undefined : classifySlotSemantics(facts));
  return {
    placeholderId: spec.placeholderId,
    displayLabel: null,
    compositionId: spec.compositionId ?? "composition-under-test",
    layerName: spec.layerName ?? "a layer",
    layerIndex: 1,
    layerPath: [],
    nestedTarget: null,
    placeholderType: "image",
    editable: true,
    sourceType: "AVLayer",
    ...(facts === null ? {} : { slotFacts: facts }),
    ...(semantics === undefined ? {} : { slotSemantics: semantics }),
    dimensions: facts === null ? null : { width: facts.widthPx ?? 0, height: facts.heightPx ?? 0 },
    startTimeSeconds: 0,
    durationSeconds: 5,
    evidence: { source: "read_directly", reason: "AE layer type is AVLayer" }
  };
}
