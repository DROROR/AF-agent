import { describe, expect, it } from "vitest";
import {
  SLOT_CONFIDENCE_THRESHOLD,
  SLOT_FINGERPRINT_VERSION,
  SLOT_SEMANTICS_MODEL_VERSION,
  assessAssetSlotCompatibility,
  assessFit,
  classifySlotSemantics,
  computeSlotFingerprint,
  selectEvidenceFrameSeconds,
  slotFingerprintsMatch,
  type SlotHostFacts,
  type SlotStructuralFacts
} from "../slot-semantics.js";

/**
 * SYNTHETIC TEMPLATES, NOT ONE REAL ONE. Each fixture below is a SHAPE a
 * template can have - a rendered-matte animated phone screen, a drawn-mask
 * card, a reused precomp, a misleadingly-named slot - built from structure
 * alone. No real template's names, ids, dimensions or hierarchy appear here.
 */
function host(overrides: Partial<SlotHostFacts> = {}): SlotHostFacts {
  return {
    compositionId: "comp-host",
    layerIndex: 4,
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

function slot(overrides: Partial<SlotStructuralFacts> = {}): SlotStructuralFacts {
  return {
    slotCompositionId: "comp-slot",
    slotLayerIndex: 1,
    slotLayerName: null,
    slotCompositionName: null,
    widthPx: 1000,
    heightPx: 1000,
    hostDepth: 1,
    hosts: [host()],
    reusedByHostCount: 1,
    transformedBounds: null,
    ...overrides
  };
}

/** A phone screen: a window cut by a rendered hardware pass, in 3D, hanging off an animated helper. */
function deviceScreenSlot(overrides: Partial<SlotStructuralFacts> = {}): SlotStructuralFacts {
  return slot({
    widthPx: 1200,
    heightPx: 2600,
    hostDepth: 2,
    hosts: [
      host({
        threeDLayer: true,
        hasTrackMatte: true,
        trackMatteType: "LUMA",
        matteSource: "RENDERED_FOOTAGE",
        parentLayerIndex: 2,
        parentIsAnimated: true,
        siblingPreRenderedPass: true,
        scalePercent: 14
      })
    ],
    ...overrides
  });
}

/** A decorative card: a plain 2D rectangle cut by a drawn mask, parented to nothing. */
function flatCardSlot(overrides: Partial<SlotStructuralFacts> = {}): SlotStructuralFacts {
  return slot({
    widthPx: 1600,
    heightPx: 900,
    hosts: [
      host({
        threeDLayer: false,
        hasTrackMatte: true,
        trackMatteType: "ALPHA",
        matteSource: "DRAWN_MASK_OR_SOLID",
        parentLayerIndex: null,
        parentIsAnimated: null,
        siblingPreRenderedPass: false
      })
    ],
    ...overrides
  });
}

describe("classifySlotSemantics - structural shapes", () => {
  it("classifies a rendered-matte, animated, 3D slot as a device screen, confidently", () => {
    const result = classifySlotSemantics(deviceScreenSlot());
    expect(result.classification).toBe("device_screen");
    expect(result.confidence).toBeGreaterThanOrEqual(SLOT_CONFIDENCE_THRESHOLD);
    expect(result.requiresHumanDecision).toBe(false);
    expect(result.modelVersion).toBe(SLOT_SEMANTICS_MODEL_VERSION);
    expect(result.positiveEvidence.map((item) => item.code)).toContain("MATTE_FROM_RENDERED_FOOTAGE");
    expect(result.positiveEvidence.map((item) => item.code)).toContain("ANIMATED_PARENT");
  });

  it("classifies a drawn-mask, 2D, unparented slot as a flat card, confidently", () => {
    const result = classifySlotSemantics(flatCardSlot());
    expect(result.classification).toBe("flat_card");
    expect(result.confidence).toBeGreaterThanOrEqual(SLOT_CONFIDENCE_THRESHOLD);
    expect(result.requiresHumanDecision).toBe(false);
    expect(result.positiveEvidence.map((item) => item.code)).toContain("MATTE_FROM_DRAWN_MASK");
  });

  it("classifies a plain un-matted 2D rectangle as a flat card", () => {
    const result = classifySlotSemantics(slot({ widthPx: 1200, heightPx: 1200, hosts: [host({ threeDLayer: false, matteSource: "NONE" })] }));
    expect(result.classification).toBe("flat_card");
    expect(result.requiresHumanDecision).toBe(false);
  });

  it("treats a 3D slot whose matte is a drawn mask as genuinely conflicting, and refuses to settle it", () => {
    const result = classifySlotSemantics(
      slot({
        widthPx: 1200,
        heightPx: 2600,
        hosts: [host({ threeDLayer: true, hasTrackMatte: true, matteSource: "DRAWN_MASK_OR_SOLID", parentIsAnimated: true, parentLayerIndex: 3 })]
      })
    );
    expect(result.conflicting).toBe(true);
    expect(result.confidence).toBeLessThan(SLOT_CONFIDENCE_THRESHOLD);
    expect(result.requiresHumanDecision).toBe(true);
    expect(result.reason).toContain("BOTH");
    expect(result.negativeEvidence.length).toBeGreaterThan(0);
  });

  it("returns unknown when there is no structural evidence at all", () => {
    const result = classifySlotSemantics(
      slot({ widthPx: null, heightPx: null, hosts: [host({ threeDLayer: null, hasTrackMatte: null, matteSource: "UNKNOWN", parentLayerIndex: 7 })] })
    );
    expect(result.classification).toBe("unknown");
    expect(result.confidence).toBe(0);
    expect(result.requiresHumanDecision).toBe(true);
  });

  it("treats a single weak signal as low confidence rather than a verdict", () => {
    const result = classifySlotSemantics(slot({ widthPx: 1000, heightPx: 1000, hosts: [host({ threeDLayer: null, matteSource: "UNKNOWN", parentLayerIndex: 2 })] }));
    expect(result.confidence).toBeLessThan(SLOT_CONFIDENCE_THRESHOLD);
    expect(result.requiresHumanDecision).toBe(true);
  });

  it("classifies a slot reused by several hosts from the hosts' own structure, not from the reuse itself", () => {
    const shared = deviceScreenSlot({
      reusedByHostCount: 3,
      hosts: [
        host({ compositionId: "comp-a", threeDLayer: true, hasTrackMatte: true, matteSource: "RENDERED_FOOTAGE", parentIsAnimated: true, parentLayerIndex: 1 }),
        host({ compositionId: "comp-b", layerIndex: 9, threeDLayer: true, hasTrackMatte: true, matteSource: "RENDERED_FOOTAGE", parentIsAnimated: true, parentLayerIndex: 2 })
      ]
    });
    const result = classifySlotSemantics(shared);
    expect(result.classification).toBe("device_screen");
    expect(result.positiveEvidence.filter((item) => item.code === "MATTE_FROM_RENDERED_FOOTAGE")).toHaveLength(2);
  });

  it("flags a slot whose two hosts disagree, rather than picking the first one", () => {
    const result = classifySlotSemantics(
      slot({
        hosts: [
          host({ compositionId: "comp-a", threeDLayer: true, hasTrackMatte: true, matteSource: "RENDERED_FOOTAGE", parentIsAnimated: true, parentLayerIndex: 1 }),
          host({ compositionId: "comp-b", layerIndex: 6, threeDLayer: false, matteSource: "DRAWN_MASK_OR_SOLID", parentLayerIndex: null })
        ]
      })
    );
    expect(result.conflicting).toBe(true);
    expect(result.requiresHumanDecision).toBe(true);
  });

  it("classifies a deeply nested slot the same as a shallow one - depth alone decides nothing", () => {
    const shallow = classifySlotSemantics(deviceScreenSlot({ hostDepth: 1 }));
    const deep = classifySlotSemantics(deviceScreenSlot({ hostDepth: 5 }));
    expect(deep.classification).toBe(shallow.classification);
    expect(deep.confidence).toBeCloseTo(shallow.confidence, 10);
  });
});

describe("classifySlotSemantics - names are weak evidence and never decide", () => {
  it("does not classify a flat card as a screen just because every name says screen", () => {
    const misleading = flatCardSlot({
      slotLayerName: "Phone Screen Placeholder",
      slotCompositionName: "Device Screen Comp",
      hosts: [{ ...flatCardSlot().hosts[0]!, layerName: "Mobile Display" }]
    });
    const result = classifySlotSemantics(misleading);
    expect(result.classification).toBe("flat_card");
    expect(result.positiveEvidence.some((item) => item.weakNameEvidence)).toBe(false);
    // The contrary name evidence is still REPORTED, on the other side.
    expect(result.negativeEvidence.some((item) => item.weakNameEvidence && item.code === "SLOT_NAME_SUGGESTS_DEVICE")).toBe(true);
  });

  it("does not classify a device screen as a card just because every name says card", () => {
    const misleading = deviceScreenSlot({
      slotLayerName: "Decorative Card",
      slotCompositionName: "Panel Rectangle",
      hosts: [{ ...deviceScreenSlot().hosts[0]!, layerName: "Banner Tile" }]
    });
    expect(classifySlotSemantics(misleading).classification).toBe("device_screen");
  });

  it("renaming everything can never change a classification or its confidence", () => {
    for (const base of [deviceScreenSlot(), flatCardSlot()]) {
      const unnamed = classifySlotSemantics(base);
      const named = classifySlotSemantics({
        ...base,
        slotLayerName: "screen phone device",
        slotCompositionName: "card panel banner",
        hosts: base.hosts.map((item) => ({ ...item, layerName: "screen card display tile" }))
      });
      expect(named.classification).toBe(unnamed.classification);
      expect(named.confidence).toBeCloseTo(unnamed.confidence, 10);
    }
  });

  it("names alone never lift an unknown slot into a verdict", () => {
    const nameOnly = slot({
      widthPx: null,
      heightPx: null,
      slotLayerName: "Phone Screen",
      slotCompositionName: "Device Display",
      hosts: [host({ threeDLayer: null, hasTrackMatte: null, matteSource: "UNKNOWN", parentLayerIndex: 3, layerName: "Mobile Screen" })]
    });
    const result = classifySlotSemantics(nameOnly);
    expect(result.classification).toBe("unknown");
    expect(result.requiresHumanDecision).toBe(true);
  });
});

describe("computeSlotFingerprint", () => {
  it("is stable for identical structure and versioned", () => {
    const a = computeSlotFingerprint(deviceScreenSlot());
    const b = computeSlotFingerprint(deviceScreenSlot());
    expect(a).toEqual(b);
    expect(a.version).toBe(SLOT_FINGERPRINT_VERSION);
    expect(slotFingerprintsMatch(a, b)).toBe(true);
  });

  it("changes when any structural fact changes", () => {
    const base = computeSlotFingerprint(deviceScreenSlot());
    const mutations: SlotStructuralFacts[] = [
      deviceScreenSlot({ slotLayerIndex: 2 }),
      deviceScreenSlot({ slotCompositionId: "comp-other" }),
      deviceScreenSlot({ widthPx: 1201 }),
      deviceScreenSlot({ hostDepth: 3 }),
      deviceScreenSlot({ reusedByHostCount: 2 }),
      deviceScreenSlot({ transformedBounds: { widthPx: 400, heightPx: 800 } }),
      deviceScreenSlot({ hosts: [host({ threeDLayer: false })] }),
      deviceScreenSlot({ hosts: [{ ...deviceScreenSlot().hosts[0]!, matteSource: "DRAWN_MASK_OR_SOLID" }] }),
      deviceScreenSlot({ hosts: [{ ...deviceScreenSlot().hosts[0]!, parentLayerIndex: 99 }] }),
      deviceScreenSlot({ hosts: [{ ...deviceScreenSlot().hosts[0]!, scalePercent: 15 }] })
    ];
    for (const mutated of mutations) {
      expect(computeSlotFingerprint(mutated).digest).not.toBe(base.digest);
    }
  });

  it("ignores renames - a rename is not a structural change, and must not fail an approved plan", () => {
    const renamed = deviceScreenSlot({
      slotLayerName: "totally different name",
      slotCompositionName: "another name",
      hosts: [{ ...deviceScreenSlot().hosts[0]!, layerName: "renamed host" }]
    });
    expect(computeSlotFingerprint(renamed).digest).toBe(computeSlotFingerprint(deviceScreenSlot()).digest);
  });

  it("never matches across fingerprint versions, or against a missing fingerprint", () => {
    const current = computeSlotFingerprint(deviceScreenSlot());
    expect(slotFingerprintsMatch(current, { version: "slot-fingerprint-v0", digest: current.digest })).toBe(false);
    expect(slotFingerprintsMatch(current, null)).toBe(false);
    expect(slotFingerprintsMatch(null, current)).toBe(false);
  });
});

describe("assessAssetSlotCompatibility", () => {
  const deviceSlot = { classification: "device_screen" as const, widthPx: 1200, heightPx: 2600 };
  const cardSlot = { classification: "flat_card" as const, widthPx: 1600, heightPx: 900 };

  it("accepts a screenshot-shaped image in a device screen", () => {
    const result = assessAssetSlotCompatibility(deviceSlot, { declaredRole: "image", widthPx: 1170, heightPx: 2532, hasAlpha: false });
    expect(result.status).toBe("COMPATIBLE");
    expect(result.requiresHumanDecision).toBe(false);
  });

  it("blocks a logo mapped into a device screen", () => {
    const result = assessAssetSlotCompatibility(deviceSlot, { declaredRole: "logo", widthPx: 800, heightPx: 800, hasAlpha: true });
    expect(result.status).toBe("CONFLICT");
    expect(result.findings.map((finding) => finding.code)).toContain("LOGO_INTO_DEVICE_SCREEN");
    expect(result.requiresHumanDecision).toBe(true);
  });

  it("blocks a transparent asset in a device screen, whatever its declared role", () => {
    const result = assessAssetSlotCompatibility(deviceSlot, { declaredRole: "image", widthPx: 1170, heightPx: 2532, hasAlpha: true });
    expect(result.findings.map((finding) => finding.code)).toContain("TRANSPARENT_ASSET_INTO_DEVICE_SCREEN");
    expect(result.requiresHumanDecision).toBe(true);
  });

  it("blocks a full-bleed screenshot dropped into a decorative card", () => {
    const result = assessAssetSlotCompatibility(cardSlot, { declaredRole: "image", widthPx: 1170, heightPx: 2532, hasAlpha: false });
    expect(result.findings.map((finding) => finding.code)).toContain("SCREENSHOT_INTO_FLAT_CARD");
    expect(result.requiresHumanDecision).toBe(true);
  });

  it("accepts a logo with transparency in a flat card", () => {
    const result = assessAssetSlotCompatibility(cardSlot, { declaredRole: "logo", widthPx: 1400, heightPx: 800, hasAlpha: true });
    expect(result.status).toBe("COMPATIBLE");
  });

  it("reports a notable aspect mismatch without blocking, and a severe one by blocking", () => {
    const notable = assessAssetSlotCompatibility(cardSlot, { declaredRole: "logo", widthPx: 1200, heightPx: 900, hasAlpha: true });
    expect(notable.findings.some((finding) => finding.code === "ASPECT_MISMATCH")).toBe(true);
    expect(notable.status).toBe("COMPATIBLE");

    const severe = assessAssetSlotCompatibility(cardSlot, { declaredRole: "logo", widthPx: 400, heightPx: 2000, hasAlpha: true });
    expect(severe.findings.some((finding) => finding.code === "SEVERE_ASPECT_MISMATCH")).toBe(true);
    expect(severe.status).toBe("CONFLICT");
  });

  it("is UNVERIFIABLE - and blocking - when the role or the dimensions are unknown", () => {
    expect(assessAssetSlotCompatibility(deviceSlot, { declaredRole: null, widthPx: 100, heightPx: 100, hasAlpha: false }).status).toBe("UNVERIFIABLE");
    expect(assessAssetSlotCompatibility(deviceSlot, { declaredRole: "image", widthPx: null, heightPx: null, hasAlpha: false }).status).toBe("UNVERIFIABLE");
    expect(assessAssetSlotCompatibility(deviceSlot, { declaredRole: "image", widthPx: null, heightPx: null, hasAlpha: false }).requiresHumanDecision).toBe(true);
  });

  it("cannot be influenced by a filename - it never receives one", () => {
    // Structural guarantee: AssetFacts has no filename field at all, so a
    // caller cannot pass one even by accident.
    const facts = { declaredRole: "logo", widthPx: 800, heightPx: 800, hasAlpha: true } as const;
    expect(Object.keys(facts)).not.toContain("filename");
    expect(assessAssetSlotCompatibility(deviceSlot, facts).status).toBe("CONFLICT");
  });

  it("does not judge an unknown slot by guessing - it reports only what it can measure", () => {
    const result = assessAssetSlotCompatibility({ classification: "unknown", widthPx: 1000, heightPx: 1000 }, { declaredRole: "logo", widthPx: 900, heightPx: 900, hasAlpha: true });
    expect(result.status).toBe("COMPATIBLE");
    expect(result.findings.some((finding) => finding.code === "LOGO_INTO_DEVICE_SCREEN")).toBe(false);
  });
});

describe("assessFit", () => {
  const portraitSlot = { widthPx: 1200, heightPx: 2600 };

  it("contain: fits a differently-shaped asset whole, and reports the empty slot area", () => {
    const result = assessFit({ slot: portraitSlot, asset: { widthPx: 1600, heightPx: 900 }, mode: "contain" });
    expect(result.uniform).toBe(true);
    expect(result.assetCroppedPercent).toBeCloseTo(0, 6);
    expect(result.unusedSlotAreaPercent ?? 0).toBeGreaterThan(50);
    expect(result.flags).toContain("LARGE_UNUSED_AREA");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("plain rectangle");
  });

  it("cover: fills the slot and reports what it cuts away", () => {
    const result = assessFit({ slot: portraitSlot, asset: { widthPx: 1600, heightPx: 900 }, mode: "cover" });
    expect(result.uniform).toBe(true);
    expect(result.slotCoveragePercent).toBeCloseTo(100, 6);
    expect(result.assetCroppedPercent ?? 0).toBeGreaterThan(70);
    expect(result.flags).toContain("EXCESSIVE_CROP");
    expect(result.safe).toBe(false);
  });

  it("stretch: reports the distortion it introduces", () => {
    const result = assessFit({ slot: portraitSlot, asset: { widthPx: 1600, heightPx: 900 }, mode: "stretch" });
    expect(result.uniform).toBe(false);
    expect(result.distortionPercent ?? 0).toBeGreaterThan(2);
    expect(result.flags).toContain("DISTORTED");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("out of shape");
  });

  it("a well-matched asset fits safely in every uniform mode", () => {
    for (const mode of ["contain", "cover", "stretch"] as const) {
      const result = assessFit({ slot: portraitSlot, asset: { widthPx: 1170, heightPx: 2535 }, mode });
      expect(result.safe).toBe(true);
      expect(result.flags).toEqual([]);
    }
  });

  it("an exactly-matching asset is never distorted, even stretched", () => {
    const result = assessFit({ slot: portraitSlot, asset: { widthPx: 600, heightPx: 1300 }, mode: "stretch" });
    expect(result.uniform).toBe(true);
    expect(result.distortionPercent).toBeCloseTo(0, 6);
    expect(result.safe).toBe(true);
  });

  it("reports scale honestly for an asset far smaller or larger than its slot", () => {
    const upscaled = assessFit({ slot: portraitSlot, asset: { widthPx: 120, heightPx: 260 }, mode: "cover" });
    expect(upscaled.scaleXPercent).toBeCloseTo(1000, 6);
    const downscaled = assessFit({ slot: portraitSlot, asset: { widthPx: 12000, heightPx: 26000 }, mode: "cover" });
    expect(downscaled.scaleXPercent).toBeCloseTo(10, 6);
  });

  it("is unsafe and explicit when dimensions are unknown - never a guessed fit", () => {
    const result = assessFit({ slot: { widthPx: null, heightPx: null }, asset: { widthPx: 100, heightPx: 100 }, mode: "cover" });
    expect(result.flags).toEqual(["DIMENSIONS_UNKNOWN"]);
    expect(result.safe).toBe(false);
    expect(result.scaleXPercent).toBeNull();
  });
});

describe("selectEvidenceFrameSeconds", () => {
  it("picks the middle of the window the slot is actually on screen - never its first frame, which is routinely mid-transition", () => {
    expect(selectEvidenceFrameSeconds(slot({ visibleWindowSeconds: { startSeconds: 2, endSeconds: 6 } }))).toBe(4);
    expect(selectEvidenceFrameSeconds(slot({ visibleWindowSeconds: { startSeconds: 0, endSeconds: 1 } }))).toBe(0.5);
  });

  it("reports that there is no provable moment rather than capturing an arbitrary frame", () => {
    expect(selectEvidenceFrameSeconds(slot({ visibleWindowSeconds: null }))).toBeNull();
    const { visibleWindowSeconds: _absent, ...withoutWindow } = slot();
    expect(selectEvidenceFrameSeconds(withoutWindow as SlotStructuralFacts)).toBeNull();
  });

  it("refuses a window with no duration - a slot on screen for zero seconds shows nothing", () => {
    expect(selectEvidenceFrameSeconds(slot({ visibleWindowSeconds: { startSeconds: 3, endSeconds: 3 } }))).toBeNull();
  });
});
