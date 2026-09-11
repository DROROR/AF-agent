import { describe, expect, it } from "vitest";
import { isThirdPartyEffectMatchName, parseProjectPreflightScan } from "../parse-project-preflight-scan.js";

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
      compositionsWithEffects: [
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
      compositionsWithEffects: [composition(2, 1, "Main", [layer(1, "Blur", [{ name: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2", enabled: true }])])]
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
      compositionsWithEffects: [composition(2, 1, "Main", [layer(1, "E", [{ name: "Element", matchName: "VIDEOCOPILOT 3DArray", enabled: false }])])]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.pluginReferences).toEqual(["VIDEOCOPILOT 3DArray"]);
  });

  it("dedupes and sorts fonts, and separates resolvable footage from AE's own footageMissing items", () => {
    const result = parseProjectPreflightScan({
      ok: true,
      compositionCount: 4,
      compositionsWithEffects: [],
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
    const result = parseProjectPreflightScan({ ok: true, compositionCount: 1, compositionsWithEffects: [] });

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
