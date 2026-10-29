import { describe, expect, it } from "vitest";
import { computeSlotMutationFingerprint } from "@dyo/schemas";
import { verifyLiveSlotStructure } from "./verify-slot-structure.js";

const hop = { compositionId: "comp-3270", layerIndex: 3, threeDLayer: false, hasTrackMatte: false, trackMatteType: "NO_TRACK_MATTE", parentLayerIndex: null, scalePercent: 100, rotationDegrees: 0 };
const target = [{ compositionId: "comp-3270", layerIndex: 3, aeProjectItemIndex: 29, numericId: 3270 }];

describe("verifyLiveSlotStructure", () => {
  it("accepts when the live chain and the target's own source size reproduce the approved fingerprint", () => {
    const expected = computeSlotMutationFingerprint({ chain: [hop], targetLayerIndex: 3, targetWidthPx: 1242, targetHeightPx: 2688 });
    const live = { ok: true as const, hops: [hop], targetWidthPx: 1242, targetHeightPx: 2688, targetCompositionWidthPx: 1242, targetCompositionHeightPx: 2648 };
    expect(verifyLiveSlotStructure(live, target, expected)).toEqual({ ok: true });
  });

  it("REAL 2026-10-29: a manifest that recorded a solid placeholder at its composition's size (1242×2648, solid is 2688 tall) is still accepted - the chain is unchanged", () => {
    const expected = computeSlotMutationFingerprint({ chain: [hop], targetLayerIndex: 3, targetWidthPx: 1242, targetHeightPx: 2648 });
    const live = { ok: true as const, hops: [hop], targetWidthPx: 1242, targetHeightPx: 2688, targetCompositionWidthPx: 1242, targetCompositionHeightPx: 2648 };
    expect(verifyLiveSlotStructure(live, target, expected)).toEqual({ ok: true });
  });

  it("still refuses when a hop changed, whichever size is read", () => {
    const expected = computeSlotMutationFingerprint({ chain: [hop], targetLayerIndex: 3, targetWidthPx: 1242, targetHeightPx: 2648 });
    const live = { ok: true as const, hops: [{ ...hop, scalePercent: 50 }], targetWidthPx: 1242, targetHeightPx: 2688, targetCompositionWidthPx: 1242, targetCompositionHeightPx: 2648 };
    const result = verifyLiveSlotStructure(live, target, expected);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("structure has changed since the plan was approved");
  });

  it("an older worker script that does not report the composition size cannot match the legacy form, and says so", () => {
    const expected = computeSlotMutationFingerprint({ chain: [hop], targetLayerIndex: 3, targetWidthPx: 1242, targetHeightPx: 2648 });
    const live = { ok: true as const, hops: [hop], targetWidthPx: 1242, targetHeightPx: 2688 };
    expect(verifyLiveSlotStructure(live, target, expected).ok).toBe(false);
  });

  it("an unreadable live chain is a refusal, never a pass", () => {
    const expected = computeSlotMutationFingerprint({ chain: [hop], targetLayerIndex: 3, targetWidthPx: 1, targetHeightPx: 1 });
    expect(verifyLiveSlotStructure({ ok: false, reason: "AE busy" }, target, expected)).toEqual({ ok: false, reason: expect.stringContaining("AE busy") });
  });
});
