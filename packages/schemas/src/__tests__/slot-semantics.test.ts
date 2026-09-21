import { describe, expect, it } from "vitest";
import {
  SLOT_CONFIDENCE_THRESHOLD,
  SLOT_FINGERPRINT_VERSION,
  SLOT_SEMANTICS_MODEL_VERSION,
  assessAssetSlotCompatibility,
  assessFit,
  classifySlotSemantics,
  computeEffectiveVisibility,
  computeSlotFingerprint,
  selectEvidenceFrameSeconds,
  slotFingerprintsMatch,
  type AssetFacts,
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

/**
 * Asset facts with the transparency facts kept apart the way the real probe
 * reports them: `hasAlphaChannel` is what the FILE can carry, and
 * `hasTransparentPixels`/`transparentPixelRatio` are what its PIXELS actually
 * contain. `undefined` for the pixel facts models "could not be decoded".
 */
function asset(overrides: Partial<AssetFacts> & { declaredRole: string | null; widthPx: number | null; heightPx: number | null }): AssetFacts {
  return {
    hasAlphaChannel: false,
    hasTransparentPixels: false,
    transparentPixelRatio: 0,
    visibleCoverageRatio: 1,
    visibleContentBounds: null,
    ...overrides
  };
}

describe("assessAssetSlotCompatibility", () => {
  const deviceSlot = { classification: "device_screen" as const, widthPx: 1200, heightPx: 2600 };
  const cardSlot = { classification: "flat_card" as const, widthPx: 1600, heightPx: 900 };

  it("accepts a screenshot-shaped image in a device screen", () => {
    const result = assessAssetSlotCompatibility(deviceSlot, asset({ declaredRole: "image", widthPx: 1170, heightPx: 2532 }));
    expect(result.status).toBe("COMPATIBLE");
    expect(result.requiresHumanDecision).toBe(false);
  });

  it("blocks a logo mapped into a device screen", () => {
    const result = assessAssetSlotCompatibility(deviceSlot, asset({ declaredRole: "logo", widthPx: 800, heightPx: 800, hasAlphaChannel: true, hasTransparentPixels: true, transparentPixelRatio: 0.7, visibleCoverageRatio: 0.3 }));
    expect(result.status).toBe("CONFLICT");
    expect(result.findings.map((finding) => finding.code)).toContain("LOGO_INTO_DEVICE_SCREEN");
    expect(result.requiresHumanDecision).toBe(true);
  });

  it("blocks a transparent asset in a device screen, whatever its declared role", () => {
    const result = assessAssetSlotCompatibility(deviceSlot, asset({ declaredRole: "image", widthPx: 1170, heightPx: 2532, hasAlphaChannel: true, hasTransparentPixels: true, transparentPixelRatio: 0.4, visibleCoverageRatio: 0.6 }));
    expect(result.findings.map((finding) => finding.code)).toContain("TRANSPARENT_ASSET_INTO_DEVICE_SCREEN");
    expect(result.requiresHumanDecision).toBe(true);
  });

  it("blocks a full-bleed screenshot dropped into a decorative card", () => {
    const result = assessAssetSlotCompatibility(cardSlot, asset({ declaredRole: "image", widthPx: 1170, heightPx: 2532 }));
    expect(result.findings.map((finding) => finding.code)).toContain("SCREENSHOT_INTO_FLAT_CARD");
    expect(result.requiresHumanDecision).toBe(true);
  });

  it("accepts a logo with transparency in a flat card", () => {
    const result = assessAssetSlotCompatibility(cardSlot, asset({ declaredRole: "logo", widthPx: 1400, heightPx: 800, hasAlphaChannel: true, hasTransparentPixels: true, transparentPixelRatio: 0.5, visibleCoverageRatio: 0.5 }));
    expect(result.status).toBe("COMPATIBLE");
  });

  it("reports a notable aspect mismatch without blocking, and a severe one by blocking", () => {
    const notable = assessAssetSlotCompatibility(cardSlot, asset({ declaredRole: "logo", widthPx: 1200, heightPx: 900, hasAlphaChannel: true, hasTransparentPixels: true, transparentPixelRatio: 0.5, visibleCoverageRatio: 0.5 }));
    expect(notable.findings.some((finding) => finding.code === "ASPECT_MISMATCH")).toBe(true);
    expect(notable.status).toBe("COMPATIBLE");

    const severe = assessAssetSlotCompatibility(cardSlot, asset({ declaredRole: "logo", widthPx: 400, heightPx: 2000, hasAlphaChannel: true, hasTransparentPixels: true, transparentPixelRatio: 0.5, visibleCoverageRatio: 0.5 }));
    expect(severe.findings.some((finding) => finding.code === "SEVERE_ASPECT_MISMATCH")).toBe(true);
    expect(severe.status).toBe("CONFLICT");
  });

  it("is UNVERIFIABLE - and blocking - when the role or the dimensions are unknown", () => {
    expect(assessAssetSlotCompatibility(deviceSlot, asset({ declaredRole: null, widthPx: 100, heightPx: 100 })).status).toBe("UNVERIFIABLE");
    expect(assessAssetSlotCompatibility(deviceSlot, asset({ declaredRole: "image", widthPx: null, heightPx: null })).status).toBe("UNVERIFIABLE");
    expect(assessAssetSlotCompatibility(deviceSlot, asset({ declaredRole: "image", widthPx: null, heightPx: null })).requiresHumanDecision).toBe(true);
  });

  it("cannot be influenced by a filename - it never receives one", () => {
    // Structural guarantee: AssetFacts has no filename field at all, so a
    // caller cannot pass one even by accident.
    const facts = asset({ declaredRole: "logo", widthPx: 800, heightPx: 800, hasAlphaChannel: true, hasTransparentPixels: true, transparentPixelRatio: 0.7, visibleCoverageRatio: 0.3 });
    expect(Object.keys(facts)).not.toContain("filename");
    expect(assessAssetSlotCompatibility(deviceSlot, facts).status).toBe("CONFLICT");
  });

  it("does not judge an unknown slot by guessing - it reports only what it can measure", () => {
    const result = assessAssetSlotCompatibility({ classification: "unknown", widthPx: 1000, heightPx: 1000 }, asset({ declaredRole: "logo", widthPx: 900, heightPx: 900, hasAlphaChannel: true, hasTransparentPixels: true, transparentPixelRatio: 0.5 }));
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

/**
 * 2026-09-21 CORRECTION: transparency is a fact about PIXELS, never about the
 * container. An alpha channel is a capability; a screenshot exported as RGBA is
 * opaque, and a palette image can declare a transparent colour it never uses.
 */
describe("assessAssetSlotCompatibility - alpha capability never stands in for transparency", () => {
  const deviceSlot = { classification: "device_screen" as const, widthPx: 1200, heightPx: 2600 };
  const cardSlot = { classification: "flat_card" as const, widthPx: 1600, heightPx: 900 };

  const opaqueRgba = {
    declaredRole: "image",
    widthPx: 1170,
    heightPx: 2532,
    hasAlphaChannel: true,
    hasTransparentPixels: false,
    transparentPixelRatio: 0,
    visibleCoverageRatio: 1,
    visibleContentBounds: null
  } as const;

  it("accepts a fully opaque RGBA screenshot in a device screen - the alpha channel alone proves nothing", () => {
    const result = assessAssetSlotCompatibility(deviceSlot, opaqueRgba);
    expect(result.findings.map((finding) => finding.code)).not.toContain("TRANSPARENT_ASSET_INTO_DEVICE_SCREEN");
    expect(result.requiresHumanDecision).toBe(false);
    expect(result.status).toBe("COMPATIBLE");
  });

  it("reports the unused alpha channel as evidence, without blocking on it", () => {
    const finding = assessAssetSlotCompatibility(deviceSlot, opaqueRgba).findings.find((candidate) => candidate.code === "ALPHA_CHANNEL_UNUSED");
    expect(finding?.blocking).toBe(false);
  });

  it("treats a fully opaque RGBA screenshot as a screenshot in a decorative card, exactly like a JPEG", () => {
    const codes = assessAssetSlotCompatibility(cardSlot, { ...opaqueRgba, widthPx: 1600, heightPx: 900 }).findings.map((finding) => finding.code);
    expect(codes).toContain("SCREENSHOT_INTO_FLAT_CARD");
  });

  it("ignores incidental transparency - a few antialiased edge pixels are not a see-through background", () => {
    const roundedCorners = { ...opaqueRgba, hasTransparentPixels: true, transparentPixelRatio: 0.004, visibleCoverageRatio: 0.996 };
    const result = assessAssetSlotCompatibility(deviceSlot, roundedCorners);
    expect(result.findings.map((finding) => finding.code)).not.toContain("TRANSPARENT_ASSET_INTO_DEVICE_SCREEN");
    expect(result.requiresHumanDecision).toBe(false);
  });

  it("still blocks a genuinely see-through asset in a device screen, and says how much of it is see-through", () => {
    const logo = { ...opaqueRgba, declaredRole: "logo", hasTransparentPixels: true, transparentPixelRatio: 0.82, visibleCoverageRatio: 0.18 };
    const finding = assessAssetSlotCompatibility(deviceSlot, logo).findings.find((candidate) => candidate.code === "TRANSPARENT_ASSET_INTO_DEVICE_SCREEN");
    expect(finding?.blocking).toBe(true);
    expect(finding?.detail).toContain("82%");
  });

  it("refuses to guess when the pixels could not be decoded - unknown is neither opaque nor transparent", () => {
    const undecoded = { ...opaqueRgba, hasTransparentPixels: null, transparentPixelRatio: null, visibleCoverageRatio: null };
    const result = assessAssetSlotCompatibility(deviceSlot, undecoded);
    expect(result.status).toBe("UNVERIFIABLE");
    expect(result.requiresHumanDecision).toBe(true);
    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain("ASSET_TRANSPARENCY_UNKNOWN");
    // It does not silently take either side while doing so.
    expect(codes).not.toContain("TRANSPARENT_ASSET_INTO_DEVICE_SCREEN");
    expect(codes).not.toContain("SCREENSHOT_INTO_FLAT_CARD");
  });

  it("does not demand a transparency answer where transparency could not change anything", () => {
    // A decorative card looks intentional with or without transparency, so an
    // asset whose pixels could not be decoded - a video frame, a format this
    // host cannot read - is not held up over it.
    const undecoded = { ...opaqueRgba, hasTransparentPixels: null, transparentPixelRatio: null, visibleCoverageRatio: null };
    for (const declaredRole of ["logo", "image"]) {
      const result = assessAssetSlotCompatibility(cardSlot, { ...undecoded, declaredRole, widthPx: 1400, heightPx: 800 });
      expect(result.findings.map((finding) => finding.code)).not.toContain("ASSET_TRANSPARENCY_UNKNOWN");
      expect(result.status).toBe("COMPATIBLE");
    }
  });
});

describe("assessFit - coverage follows the visible content, not the file's box", () => {
  const slot = { widthPx: 1000, heightPx: 1000 };

  it("flags a logo that fills the slot on paper but is mostly transparent padding", () => {
    const fit = assessFit({
      slot,
      // The file is slot-shaped, but only a small block in the middle of it is
      // actually drawn.
      asset: { widthPx: 1000, heightPx: 1000, visibleContentBounds: { xPx: 400, yPx: 400, widthPx: 200, heightPx: 200 } },
      mode: "cover"
    });
    expect(fit.slotCoveragePercent).toBeCloseTo(100, 6);
    expect(fit.visibleContentCoveragePercent).toBeCloseTo(4, 6);
    expect(fit.flags).toContain("LARGE_TRANSPARENT_PADDING");
    expect(fit.flags).toContain("LARGE_UNUSED_AREA");
    expect(fit.safe).toBe(false);
    expect(fit.reason).toContain("only 4%");
  });

  it("does not punish cropping that only cuts transparent padding away", () => {
    const fit = assessFit({
      slot: { widthPx: 1000, heightPx: 1000 },
      // Twice as tall as the slot: half the FILE is cut away, but its drawn
      // content sits in the band that survives a cover fit, so nothing a
      // viewer would see is lost.
      asset: { widthPx: 1000, heightPx: 2000, visibleContentBounds: { xPx: 0, yPx: 550, widthPx: 1000, heightPx: 900 } },
      mode: "cover"
    });
    expect(fit.assetCroppedPercent).toBeCloseTo(50, 6);
    expect(fit.visibleContentCroppedPercent).toBeCloseTo(0, 6);
    expect(fit.visibleContentCoveragePercent).toBeCloseTo(90, 6);
    expect(fit.flags).not.toContain("EXCESSIVE_CROP");
    expect(fit.flags).not.toContain("LARGE_UNUSED_AREA");
    expect(fit.safe).toBe(true);
  });

  it("still reports a slot left half empty by the asset's own drawn content", () => {
    const fit = assessFit({
      slot: { widthPx: 1000, heightPx: 1000 },
      asset: { widthPx: 1000, heightPx: 2000, visibleContentBounds: { xPx: 0, yPx: 750, widthPx: 1000, heightPx: 500 } },
      mode: "cover"
    });
    expect(fit.visibleContentCoveragePercent).toBeCloseTo(50, 6);
    expect(fit.flags).toContain("LARGE_UNUSED_AREA");
    expect(fit.flags).not.toContain("EXCESSIVE_CROP");
  });

  it("still measures the file's own box when the content bounds were never measured", () => {
    const fit = assessFit({ slot, asset: { widthPx: 1000, heightPx: 1000 }, mode: "cover" });
    expect(fit.visibleContentCoveragePercent).toBeNull();
    expect(fit.visibleContentCroppedPercent).toBeNull();
    expect(fit.safe).toBe(true);
  });
});

/**
 * Evidence-frame selection is about EFFECTIVE visibility: a layer inside its
 * in/out points can still be switched off, held at zero opacity, or sitting
 * entirely outside the frame.
 */
describe("computeEffectiveVisibility / selectEvidenceFrameSeconds", () => {
  const visibleHost = (overrides: Partial<SlotHostFacts> = {}): SlotHostFacts =>
    host({ enabled: true, inFrame: true, windowSeconds: { startSeconds: 2, endSeconds: 6 }, opacityPercentAtInPoint: 100, ...overrides });

  it("picks the middle of the window a host is genuinely visible in", () => {
    expect(selectEvidenceFrameSeconds(slot({ hosts: [visibleHost()] }))).toBe(4);
  });

  it("ignores a host that is switched off, and one whose rectangle never reaches the frame", () => {
    expect(selectEvidenceFrameSeconds(slot({ hosts: [visibleHost({ enabled: false })] }))).toBeNull();
    expect(selectEvidenceFrameSeconds(slot({ hosts: [visibleHost({ inFrame: false })] }))).toBeNull();
  });

  it("refuses a host held at zero opacity for its whole window", () => {
    expect(selectEvidenceFrameSeconds(slot({ hosts: [visibleHost({ opacityPercentAtInPoint: 0 })] }))).toBeNull();
  });

  it("skips a fade and lands in the part that is actually opaque", () => {
    const faded = visibleHost({
      windowSeconds: { startSeconds: 0, endSeconds: 10 },
      opacityPercentAtInPoint: 0,
      opacityKeyframes: [
        { timeSeconds: 0, valuePercent: 0 },
        { timeSeconds: 2, valuePercent: 100 },
        { timeSeconds: 8, valuePercent: 100 },
        { timeSeconds: 10, valuePercent: 0 }
      ]
    });
    const window = computeEffectiveVisibility(slot({ hosts: [faded] }));
    // Visible from the moment it crosses the threshold on the way up to the
    // moment it crosses it on the way down - never the midpoint of 0..10 alone.
    expect(window!.startSeconds).toBeGreaterThan(0);
    expect(window!.endSeconds).toBeLessThan(10);
    const at = selectEvidenceFrameSeconds(slot({ hosts: [faded] }))!;
    expect(at).toBeGreaterThan(2);
    expect(at).toBeLessThan(8);
  });

  it("prefers the longest genuinely-visible window when a slot has several hosts", () => {
    const brief = visibleHost({ compositionId: "comp-brief", windowSeconds: { startSeconds: 0, endSeconds: 1 } });
    const long = visibleHost({ compositionId: "comp-long", windowSeconds: { startSeconds: 10, endSeconds: 20 } });
    expect(selectEvidenceFrameSeconds(slot({ hosts: [brief, long] }))).toBe(15);
  });

  it("treats unread visibility facts as unknown rather than as invisible", () => {
    const unread = host({ windowSeconds: { startSeconds: 4, endSeconds: 8 } });
    expect(selectEvidenceFrameSeconds(slot({ hosts: [unread] }))).toBe(6);
  });

  it("falls back to a manifest written before host visibility facts existed", () => {
    const legacy = slot({ hosts: [host({})], visibleWindowSeconds: { startSeconds: 1, endSeconds: 3 } });
    expect(selectEvidenceFrameSeconds(legacy)).toBe(2);
  });

  it("reports no provable moment when nothing offers one", () => {
    expect(selectEvidenceFrameSeconds(slot({ hosts: [], visibleWindowSeconds: null }))).toBeNull();
    expect(selectEvidenceFrameSeconds(slot({ hosts: [visibleHost({ windowSeconds: { startSeconds: 3, endSeconds: 3 } })] }))).toBeNull();
  });
});
