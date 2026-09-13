import { describe, expect, it } from "vitest";
import { boundLayerInventory, isThirdPartyEffectMatchName, parseProjectPreflightScan } from "../parse-project-preflight-scan.js";

function layer(layerIndex: number, layerName: string, effects: { name: string; matchName: string; enabled: boolean }[]) {
  return { layerIndex, layerName, enabled: true, effects };
}

function composition(aeProjectItemIndex: number, compositionId: number, compositionName: string, layers: ReturnType<typeof layer>[]) {
  return { aeProjectItemIndex, compositionId, compositionName, layers };
}

describe("isThirdPartyEffectMatchName", () => {
  it("treats every ADBE-prefixed matchName as native", () => {
    expect(isThirdPartyEffectMatchName("ADBE Gaussian Blur 2")).toBe(false);
    expect(isThirdPartyEffectMatchName("ADBE Curves")).toBe(false);
  });

  it("treats the real Video Copilot Element matchName proven on the 2026-09-11 client project as third-party", () => {
    expect(isThirdPartyEffectMatchName("VIDEOCOPILOT 3DArray")).toBe(true);
  });

  it("never mistakes a name that merely contains ADBE for a native one", () => {
    expect(isThirdPartyEffectMatchName("NotADBE Thing")).toBe(true);
  });
});

describe("parseProjectPreflightScan", () => {
  it("derives distinct, sorted third-party matchNames plus real affected-composition evidence, ignoring native effects entirely", () => {
    const result = parseProjectPreflightScan({
      ok: true,
      compositionCount: 83,
      compositions: [
        composition(2, 210, "Scene 4", [
          layer(1, "Element 3D", [{ name: "Element", matchName: "VIDEOCOPILOT 3DArray", enabled: true }]),
          layer(2, "Blur", [{ name: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2", enabled: true }])
        ]),
        composition(3, 211, "Pre-comp 2", [
          layer(1, "Element 3D", [{ name: "Element", matchName: "VIDEOCOPILOT 3DArray", enabled: true }])
        ]),
        composition(4, 212, "Just Native", [layer(1, "Curved", [{ name: "Curves", matchName: "ADBE Curves", enabled: true }])])
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Distinct, so one entry despite two instances.
    expect(result.evidence.pluginReferences).toEqual(["VIDEOCOPILOT 3DArray"]);
    // Real instance count - the honest scale of the dependency.
    expect(result.evidence.thirdPartyEffectInstanceCount).toBe(2);
    // Only compositions with a THIRD-PARTY effect - never the native-only one.
    expect(result.evidence.affectedCompositionNames).toEqual(["Pre-comp 2", "Scene 4"]);
  });

  it("returns a genuinely empty, confirmed result for a project whose every effect is native", () => {
    const result = parseProjectPreflightScan({
      ok: true,
      compositionCount: 12,
      compositions: [composition(2, 1, "Main", [layer(1, "Blur", [{ name: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2", enabled: true }])])]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.pluginReferences).toEqual([]);
    expect(result.evidence.thirdPartyEffectInstanceCount).toBe(0);
  });

  it("counts a disabled third-party effect too - it is still a real dependency of the project file", () => {
    const result = parseProjectPreflightScan({
      ok: true,
      compositionCount: 2,
      compositions: [composition(2, 1, "Main", [layer(1, "E", [{ name: "Element", matchName: "VIDEOCOPILOT 3DArray", enabled: false }])])]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.pluginReferences).toEqual(["VIDEOCOPILOT 3DArray"]);
  });

  it("dedupes and sorts fonts, and separates resolvable footage from AE's own footageMissing items", () => {
    const result = parseProjectPreflightScan({
      ok: true,
      compositionCount: 4,
      compositions: [],
      fonts: ["Evolventa-Regular", "Evolventa-Bold", "Evolventa-Regular"],
      footage: [
        { name: "logo.png", path: "C:\\assets\\logo.png", missing: false },
        { name: "gone.mp4", path: "C:\\assets\\gone.mp4", missing: true },
        { name: "solid", path: null, missing: false }
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.requiredFonts).toEqual(["Evolventa-Bold", "Evolventa-Regular"]);
    // A path-less item (e.g. a solid) is never reported as a referenced file.
    expect(result.evidence.footageReferenced).toEqual(["C:\\assets\\logo.png"]);
    expect(result.evidence.missingFootage).toEqual([{ name: "gone.mp4", expectedPath: "C:\\assets\\gone.mp4" }]);
    expect(result.evidence.fontAndFootageScanned).toBe(true);
  });

  it("marks fontAndFootageScanned false for a response from an older worker build that only scanned effects - so empty font/footage lists are never read as confirmed", () => {
    const result = parseProjectPreflightScan({ ok: true, compositionCount: 1, compositions: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.fontAndFootageScanned).toBe(false);
    expect(result.evidence.requiredFonts).toEqual([]);
    expect(result.evidence.missingFootage).toEqual([]);
  });

  it("reports a typed failure (never a silently empty plugin list) when the script itself reported failure", () => {
    const result = parseProjectPreflightScan({ ok: false, failureReason: "unexpected error: whatever" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/script itself reported failure/);
  });

  it("reports a typed failure (never a silently empty plugin list) for an unrecognized response shape", () => {
    const result = parseProjectPreflightScan({ totally: "unexpected" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/did not match the expected shape/);
  });
});

const NULL_DETAIL = {
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
  textPreview: null
};

describe("parseProjectPreflightScan layer inventory", () => {
  it("exposes every composition's raw layer facts, including layer-role detail, in scan order", () => {
    const matte = { ...layer(1, "Mask", []), detail: { ...NULL_DETAIL, isTrackMatte: true, sourceName: "Smartphone_01_Placeholder_Mask_1.mov" } };
    const result = parseProjectPreflightScan({
      ok: true,
      compositionCount: 2,
      compositions: [composition(5, 40, "Smartphone_01", [matte]), composition(6, 50, "Screen", [layer(1, "Text", [])])]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.layerInventory.map((c) => c.compositionName)).toEqual(["Smartphone_01", "Screen"]);
    expect(result.evidence.layerInventory[0]?.layers[0]?.detail).toMatchObject({ isTrackMatte: true, sourceName: "Smartphone_01_Placeholder_Mask_1.mov" });
    // A layer from an older worker build carries no detail at all - still accepted.
    expect(result.evidence.layerInventory[1]?.layers[0]?.detail).toBeUndefined();
  });

  it("rejects an unrecognized detail field rather than silently dropping evidence", () => {
    const withUnknownDetailField = { ...layer(1, "L", []), detail: { ...NULL_DETAIL, surprise: true } };
    const result = parseProjectPreflightScan({
      ok: true,
      compositionCount: 1,
      compositions: [composition(1, 1, "Main", [withUnknownDetailField])]
    });
    expect(result.ok).toBe(false);
  });
});

describe("boundLayerInventory", () => {
  const inventory = [1, 2, 3].map((id) => ({ ...composition(id, id, `Comp ${id}`, [layer(1, "x".repeat(100), [])]) }));

  it("keeps the whole inventory when it fits", () => {
    expect(boundLayerInventory(inventory)).toEqual({ compositions: inventory, omittedCompositionCount: 0 });
  });

  it("keeps whole compositions in order and reports exactly how many were left out once the budget is reached", () => {
    const oneEntryBytes = Buffer.byteLength(JSON.stringify(inventory[0]), "utf8") + 1;
    const bounded = boundLayerInventory(inventory, 2 + oneEntryBytes * 2);
    expect(bounded.compositions.map((c) => c.compositionId)).toEqual([1, 2]);
    expect(bounded.omittedCompositionCount).toBe(1);
  });

  it("counts multi-byte text by its real UTF-8 size, not its character count", () => {
    const hebrew = [composition(1, 1, "מבית DYO App".repeat(20), [])];
    const characters = JSON.stringify(hebrew[0]).length + 3;
    expect(boundLayerInventory(hebrew, characters).omittedCompositionCount).toBe(1);
  });
});
