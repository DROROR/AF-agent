import { describe, expect, it } from "vitest";
import { computeEffectiveVisibility, selectEvidenceFrameSeconds, type SlotStructuralFacts } from "./slot-semantics.js";

/**
 * REAL 2026-10-04 DEFECT: ten slots nested below one master composition were
 * each given an evidence frame at the same moment - the midpoint of a window
 * measured inside a nested composition - and the reviewer was shown ten
 * identical pictures of a scene none of those slots is in.
 */

const nestedHost = {
  compositionId: "c-helper",
  layerIndex: 1,
  layerName: null,
  threeDLayer: false,
  hasTrackMatte: false,
  trackMatteType: "NO_TRACK_MATTE",
  matteSource: "NONE" as const,
  parentLayerIndex: null,
  parentIsAnimated: null,
  siblingPreRenderedPass: null,
  scalePercent: 100,
  rotationDegrees: 0,
  enabled: true,
  inFrame: true,
  windowSeconds: { startSeconds: 0, endSeconds: 6 },
  opacityPercentAtInPoint: 100,
  opacityKeyframes: null
};

function slot(overrides: Partial<SlotStructuralFacts> = {}): SlotStructuralFacts {
  return {
    slotCompositionId: "c-slot",
    slotLayerIndex: 1,
    slotLayerName: null,
    slotCompositionName: null,
    widthPx: 600,
    heightPx: 1200,
    hostDepth: 3,
    hosts: [nestedHost],
    reusedByHostCount: 1,
    transformedBounds: null,
    visibleWindowSeconds: { startSeconds: 0, endSeconds: 6 },
    ...overrides
  };
}
const scene = { compositionId: "c-scene", durationSeconds: 60 };

describe("a nested slot's recorded scene window decides its evidence moment", () => {
  it("is used when the frame is rendered in that scene: the middle of the scene window, not of the nested one", () => {
    const facts = slot({ sceneWindow: { compositionId: "c-scene", startSeconds: 40, endSeconds: 46 } });
    expect(selectEvidenceFrameSeconds(facts, scene)).toBe(43);
    expect(computeEffectiveVisibility(facts, "c-scene")).toEqual({ startSeconds: 40, endSeconds: 46 });
  });

  it("is the window the gate checks a captured frame against - the same one the capture used", () => {
    const facts = slot({ sceneWindow: { compositionId: "c-scene", startSeconds: 40, endSeconds: 46 } });
    expect(computeEffectiveVisibility(facts)).toEqual({ startSeconds: 40, endSeconds: 46 });
    expect(selectEvidenceFrameSeconds(facts)).toBe(43);
  });

  it("is not used for a different composition", () => {
    const facts = slot({ sceneWindow: { compositionId: "c-scene", startSeconds: 40, endSeconds: 46 } });
    expect(computeEffectiveVisibility(facts, "c-helper")).toEqual({ startSeconds: 0, endSeconds: 6 });
  });

  it("NULL means it was looked for and not found: no moment at all, never the nested window", () => {
    const facts = slot({ sceneWindow: null });
    expect(selectEvidenceFrameSeconds(facts, scene)).toBeNull();
    expect(computeEffectiveVisibility(facts)).toBeNull();
  });

  it("a manifest written before it existed behaves exactly as before", () => {
    expect(selectEvidenceFrameSeconds(slot(), scene)).toBe(3);
    expect(computeEffectiveVisibility(slot())).toEqual({ startSeconds: 0, endSeconds: 6 });
  });
});
