import { z } from "zod";
import { sha256Hex } from "./text-digest.js";

/**
 * GENERIC SLOT SEMANTICS AND FIT VALIDATION (Stage 4, 2026-09-19).
 *
 * A template's image slots are not interchangeable. Some are DEVICE SCREENS -
 * a window cut into a rendered phone/laptop pass, usually animated in 3D -
 * and some are FLAT CARDS, decorative rectangles a designer drew. Dropping a
 * logo into a phone screen, or a full app screenshot into a small decorative
 * card, produces a video that renders perfectly and is completely wrong.
 *
 * WHAT DECIDES A CLASSIFICATION: structure only - nesting and host depth,
 * track-matte presence AND what the matte is made of, 3D state, whether the
 * host hangs off an animated parent, whether a pre-rendered beauty pass covers
 * the same region, dimensions, aspect ratio and transformed bounds.
 *
 * WHAT NEVER DECIDES ONE: names. A layer called "Phone Screen" is weak
 * supporting evidence and nothing more - `classifySlotSemantics` computes the
 * verdict from structure ALONE first, and name evidence can only ever
 * reinforce a side that structure already chose. This is enforced by
 * construction below, not by convention.
 *
 * WHAT HAPPENS WHEN IT IS NOT SURE: nothing silently. A low-confidence or
 * self-contradicting classification blocks plan approval until a human records
 * an explicit, auditable decision - the same shape as the leftover-template-copy
 * gate, for the same reason.
 */

/**
 * Bumped whenever the rules or weights below change, so a stored verdict is
 * never silently reinterpreted under different rules.
 *
 * v2 (2026-09-21): the matte-source rule was corrected - After Effects reports
 * `hasVideo` for a still image as well as a movie, so a still matte was being
 * read as a rendered hardware pass and could carry a confident device_screen
 * verdict. Any verdict produced by the previous rule is refused as stale and
 * re-inspected rather than trusted.
 */
export const SLOT_SEMANTICS_MODEL_VERSION = "slot-semantics-v2";

/** Bumped whenever the fingerprint's own inputs change - a fingerprint from an older version can never be compared with a new one. */
export const SLOT_FINGERPRINT_VERSION = "slot-fingerprint-v1";

/** Below this, a classification is not trusted on its own and needs a human decision. */
export const SLOT_CONFIDENCE_THRESHOLD = 0.7;

export const SLOT_CLASSIFICATIONS = ["device_screen", "flat_card", "unknown"] as const;
export const slotClassificationSchema = z.enum(SLOT_CLASSIFICATIONS);
export type SlotClassification = (typeof SLOT_CLASSIFICATIONS)[number];

/** What a host layer's track matte is actually made of - the single strongest structural signal, and the reason matte PRESENCE alone is never enough. */
export const MATTE_SOURCES = [
  /** The matte comes from rendered footage (a beauty/mask pass) - hardware the designer rendered, so the window it cuts is a device screen. */
  "RENDERED_FOOTAGE",
  /** The matte is a drawn mask, shape or solid - a designer's rectangle, so the window it cuts is a flat card. */
  "DRAWN_MASK_OR_SOLID",
  /** No track matte at all. */
  "NONE",
  /** A matte exists but what it is made of could not be read - never guessed either way. */
  "UNKNOWN"
] as const;
export const matteSourceSchema = z.enum(MATTE_SOURCES);
export type MatteSource = (typeof MATTE_SOURCES)[number];

/** One layer that pulls a slot's composition into a parent - the structural context that makes a slot a screen or a card. */
export const slotHostFactsSchema = z
  .object({
    compositionId: z.string().min(1),
    layerIndex: z.number().int().positive(),
    /** WEAK EVIDENCE ONLY - see this module's own doc comment. Never decides a classification. */
    layerName: z.string().nullable(),
    threeDLayer: z.boolean().nullable(),
    hasTrackMatte: z.boolean().nullable(),
    trackMatteType: z.string().nullable(),
    matteSource: matteSourceSchema,
    parentLayerIndex: z.number().int().nullable(),
    /** True when the host's parent layer has real transform keyframes - a device animation helper, rather than a static group. Null when unread. */
    parentIsAnimated: z.boolean().nullable(),
    /** True when a sibling layer in the same composition is a pre-rendered pass covering this region (real device hardware). Null when unread. */
    siblingPreRenderedPass: z.boolean().nullable(),
    /** Uniform scale percent applied to the slot by this host, when readable. */
    scalePercent: z.number().nullable(),
    rotationDegrees: z.number().nullable(),
    /**
     * EFFECTIVE VISIBILITY (2026-09-21 correction). A layer being inside its
     * in/out points does not mean anything of it is on screen: it can be
     * switched off, held at zero opacity, or positioned entirely outside the
     * frame. These are what an evidence frame's moment is actually chosen
     * from. Every one is null when unread - never assumed.
     */
    enabled: z.boolean().nullable().optional(),
    /** This host's own in/out points, in its composition's timeline. */
    windowSeconds: z.object({ startSeconds: z.number(), endSeconds: z.number() }).nullable().optional(),
    /** Opacity at the host's in point, 0..100. */
    opacityPercentAtInPoint: z.number().nullable().optional(),
    /** Opacity keyframes, bounded - what tells a zero-opacity hold apart from a visible one. */
    opacityKeyframes: z.array(z.object({ timeSeconds: z.number(), valuePercent: z.number() }).strict()).nullable().optional(),
    /** Whether this host's rendered rectangle intersects its composition's frame at all. False means nothing of the slot is on screen through this host. */
    inFrame: z.boolean().nullable().optional()
  })
  .strict();
export type SlotHostFacts = z.infer<typeof slotHostFactsSchema>;

/** Everything structural known about one candidate slot. Names are present for evidence and display; they never decide anything. */
export const slotStructuralFactsSchema = z
  .object({
    slotCompositionId: z.string().min(1),
    slotLayerIndex: z.number().int().positive(),
    /** WEAK EVIDENCE ONLY. */
    slotLayerName: z.string().nullable(),
    /** WEAK EVIDENCE ONLY. */
    slotCompositionName: z.string().nullable(),
    widthPx: z.number().positive().nullable(),
    heightPx: z.number().positive().nullable(),
    /** How many precomp hops separate this slot from the scene composition. */
    hostDepth: z.number().int().nonnegative(),
    hosts: z.array(slotHostFactsSchema),
    /** How many distinct host layers pull this same slot composition in - a shared source used by several parents. */
    reusedByHostCount: z.number().int().nonnegative(),
    /** The slot's rendered size in the top-level composition after every host transform, when computable. */
    transformedBounds: z.object({ widthPx: z.number().positive(), heightPx: z.number().positive() }).nullable(),
    /**
     * A host's raw in/out window, kept for manifests written before host-level
     * visibility facts existed. `computeEffectiveVisibility` prefers the
     * per-host facts above and only falls back to this.
     */
    visibleWindowSeconds: z.object({ startSeconds: z.number().nonnegative(), endSeconds: z.number().nonnegative() }).nullable().optional()
  })
  .strict();
export type SlotStructuralFacts = z.infer<typeof slotStructuralFactsSchema>;

export const slotEvidenceSchema = z
  .object({
    code: z.string().min(1),
    supports: z.enum(["device_screen", "flat_card"]),
    weight: z.number(),
    detail: z.string().min(1),
    /** True for name-derived evidence, which is reported but never allowed to decide - see `classifySlotSemantics`. */
    weakNameEvidence: z.boolean().default(false)
  })
  .strict();
export type SlotEvidence = z.infer<typeof slotEvidenceSchema>;

export const slotSemanticsResultSchema = z
  .object({
    modelVersion: z.string().min(1),
    classification: slotClassificationSchema,
    /** 0..1. Derived from how decisively the structural evidence favours one side, and how much of it there is. */
    confidence: z.number().min(0).max(1),
    /** True when BOTH sides carry substantial structural evidence - a slot that looks like a screen and a card at once is never silently resolved. */
    conflicting: z.boolean(),
    positiveEvidence: z.array(slotEvidenceSchema),
    negativeEvidence: z.array(slotEvidenceSchema),
    /** True when this verdict must not be acted on without an explicit human decision. */
    requiresHumanDecision: z.boolean(),
    /** Plain-words reason, non-null exactly when `requiresHumanDecision` is true. */
    reason: z.string().nullable()
  })
  .strict();
export type SlotSemanticsResult = z.infer<typeof slotSemanticsResultSchema>;

/* ------------------------------------------------------------------ *
 * Classification.
 * ------------------------------------------------------------------ */

/**
 * Structural weights. Each is a claim about MECHANISM, not about a template:
 * a rendered-footage matte means a designer rendered hardware and cut a window
 * in it; a drawn mask means they drew a rectangle. Names appear only in
 * `nameEvidence` below, at a weight that cannot reach the decision threshold.
 */
const WEIGHTS = {
  matteFromRenderedFootage: 0.35,
  siblingPreRenderedPass: 0.25,
  threeDHost: 0.2,
  animatedParent: 0.2,
  tallPortraitAspect: 0.1,
  matteFromDrawnMask: 0.3,
  noMatte: 0.25,
  twoDHost: 0.2,
  noParent: 0.1,
  wideOrSquareAspect: 0.05,
  /** Every name-derived signal put together still cannot outweigh one real structural signal. */
  nameHint: 0.05
} as const;

/** Substantial enough that the opposite side carrying it too means the evidence genuinely conflicts. */
const CONFLICT_EVIDENCE_THRESHOLD = 0.2;

const DEVICE_NAME_PATTERN = /\b(phone|device|screen|mobile|handset|tablet|laptop|monitor|display)\b/i;
const CARD_NAME_PATTERN = /\b(card|panel|tile|rect(angle)?|banner|frame)\b/i;

function aspectRatio(facts: SlotStructuralFacts): number | null {
  if (facts.widthPx === null || facts.heightPx === null || facts.heightPx === 0) {
    return null;
  }
  return facts.widthPx / facts.heightPx;
}

/**
 * Classifies one slot from structure alone, then reports (but never acts on)
 * name evidence.
 *
 * THE NAME GUARANTEE, BY CONSTRUCTION: the winning side and the confidence are
 * both computed from `structuralDevice`/`structuralFlat` - sums that contain no
 * name-derived term. Name evidence is collected into a separate list, surfaced
 * for a human, and never added to those sums. A test asserts that flipping
 * every name in a fixture cannot change the classification.
 */
export function classifySlotSemantics(facts: SlotStructuralFacts): SlotSemanticsResult {
  const deviceEvidence: SlotEvidence[] = [];
  const flatEvidence: SlotEvidence[] = [];
  const nameEvidence: SlotEvidence[] = [];

  const add = (
    into: SlotEvidence[],
    code: string,
    supports: "device_screen" | "flat_card",
    weight: number,
    detail: string,
    weak = false
  ): void => {
    into.push({ code, supports, weight, detail, weakNameEvidence: weak });
  };

  for (const host of facts.hosts) {
    const where = `host layer ${host.layerIndex} in ${host.compositionId}`;
    if (host.matteSource === "RENDERED_FOOTAGE") {
      add(deviceEvidence, "MATTE_FROM_RENDERED_FOOTAGE", "device_screen", WEIGHTS.matteFromRenderedFootage, `${where} is cut by a matte made from rendered footage - a designer-rendered hardware pass`);
    } else if (host.matteSource === "DRAWN_MASK_OR_SOLID") {
      add(flatEvidence, "MATTE_FROM_DRAWN_MASK", "flat_card", WEIGHTS.matteFromDrawnMask, `${where} is cut by a drawn mask, shape or solid - a designer-drawn shape, not rendered hardware`);
    } else if (host.matteSource === "NONE" && host.hasTrackMatte !== true) {
      add(flatEvidence, "NO_TRACK_MATTE", "flat_card", WEIGHTS.noMatte, `${where} is not cut by any track matte`);
    }

    if (host.siblingPreRenderedPass === true) {
      add(deviceEvidence, "SIBLING_PRE_RENDERED_PASS", "device_screen", WEIGHTS.siblingPreRenderedPass, `${where} sits alongside a pre-rendered pass covering the same region - real device hardware`);
    }
    if (host.threeDLayer === true) {
      add(deviceEvidence, "THREE_D_HOST", "device_screen", WEIGHTS.threeDHost, `${where} is a 3D layer`);
    } else if (host.threeDLayer === false) {
      add(flatEvidence, "TWO_D_HOST", "flat_card", WEIGHTS.twoDHost, `${where} is a plain 2D layer`);
    }
    if (host.parentIsAnimated === true) {
      add(deviceEvidence, "ANIMATED_PARENT", "device_screen", WEIGHTS.animatedParent, `${where} is parented to an animated layer - a device animation helper`);
    } else if (host.parentLayerIndex === null) {
      add(flatEvidence, "NO_PARENT", "flat_card", WEIGHTS.noParent, `${where} has no parent layer`);
    }

    if (host.layerName !== null && DEVICE_NAME_PATTERN.test(host.layerName)) {
      add(nameEvidence, "HOST_NAME_SUGGESTS_DEVICE", "device_screen", WEIGHTS.nameHint, `host layer is named "${host.layerName}" - naming only, never decisive`, true);
    }
    if (host.layerName !== null && CARD_NAME_PATTERN.test(host.layerName)) {
      add(nameEvidence, "HOST_NAME_SUGGESTS_CARD", "flat_card", WEIGHTS.nameHint, `host layer is named "${host.layerName}" - naming only, never decisive`, true);
    }
  }

  const ratio = aspectRatio(facts);
  if (ratio !== null && ratio < 0.67) {
    add(deviceEvidence, "TALL_PORTRAIT_ASPECT", "device_screen", WEIGHTS.tallPortraitAspect, `the slot is markedly taller than it is wide (${ratio.toFixed(2)}:1) - the shape of a handheld screen`);
  } else if (ratio !== null && ratio >= 0.9) {
    add(flatEvidence, "WIDE_OR_SQUARE_ASPECT", "flat_card", WEIGHTS.wideOrSquareAspect, `the slot is square or wider than tall (${ratio.toFixed(2)}:1)`);
  }

  for (const name of [facts.slotLayerName, facts.slotCompositionName]) {
    if (name === null) {
      continue;
    }
    if (DEVICE_NAME_PATTERN.test(name)) {
      add(nameEvidence, "SLOT_NAME_SUGGESTS_DEVICE", "device_screen", WEIGHTS.nameHint, `named "${name}" - naming only, never decisive`, true);
    }
    if (CARD_NAME_PATTERN.test(name)) {
      add(nameEvidence, "SLOT_NAME_SUGGESTS_CARD", "flat_card", WEIGHTS.nameHint, `named "${name}" - naming only, never decisive`, true);
    }
  }

  // THE DECISION - structural sums only. No name-derived term appears here.
  const structuralDevice = deviceEvidence.reduce((total, item) => total + item.weight, 0);
  const structuralFlat = flatEvidence.reduce((total, item) => total + item.weight, 0);
  const totalStructural = structuralDevice + structuralFlat;

  const conflicting = structuralDevice >= CONFLICT_EVIDENCE_THRESHOLD && structuralFlat >= CONFLICT_EVIDENCE_THRESHOLD;
  const winner: SlotClassification =
    totalStructural === 0 || structuralDevice === structuralFlat ? "unknown" : structuralDevice > structuralFlat ? "device_screen" : "flat_card";

  // Confidence combines HOW DECISIVELY one side wins with HOW MUCH structural
  // evidence exists at all: one weak signal alone is never high confidence.
  const margin = totalStructural === 0 ? 0 : Math.abs(structuralDevice - structuralFlat) / totalStructural;
  const mass = Math.min(1, totalStructural / 0.8);
  const rawConfidence = winner === "unknown" ? 0 : margin * mass;
  const confidence = conflicting ? Math.min(rawConfidence, SLOT_CONFIDENCE_THRESHOLD - 0.01) : rawConfidence;

  const winningEvidence = winner === "device_screen" ? deviceEvidence : winner === "flat_card" ? flatEvidence : [];
  const losingEvidence = winner === "device_screen" ? flatEvidence : winner === "flat_card" ? deviceEvidence : [...deviceEvidence, ...flatEvidence];

  const requiresHumanDecision = winner === "unknown" || conflicting || confidence < SLOT_CONFIDENCE_THRESHOLD;
  const reason = !requiresHumanDecision
    ? null
    : winner === "unknown"
      ? "this slot's structure does not say whether it is a device screen or a flat card - confirm which it is before approving"
      : conflicting
        ? `this slot shows substantial evidence of being BOTH a device screen and a flat card - confirm which it is before approving`
        : `this slot looks like a ${winner === "device_screen" ? "device screen" : "flat card"}, but not confidently enough to act on (${Math.round(confidence * 100)}%, threshold ${Math.round(SLOT_CONFIDENCE_THRESHOLD * 100)}%) - confirm it before approving`;

  return {
    modelVersion: SLOT_SEMANTICS_MODEL_VERSION,
    classification: winner,
    confidence,
    conflicting,
    positiveEvidence: [...winningEvidence, ...nameEvidence.filter((item) => item.supports === winner)],
    negativeEvidence: [...losingEvidence, ...nameEvidence.filter((item) => item.supports !== winner)],
    requiresHumanDecision,
    reason
  };
}

/* ------------------------------------------------------------------ *
 * Structural fingerprint.
 * ------------------------------------------------------------------ */

export const slotFingerprintSchema = z.object({ version: z.string().min(1), digest: z.string().length(64) }).strict();
export type SlotFingerprint = z.infer<typeof slotFingerprintSchema>;

/**
 * A digest of everything structural about a slot - composition and layer
 * identity, geometry, matte wiring, 3D state, parent chain and host structure.
 *
 * Recomputed from the LIVE project immediately before any mutation: if a later
 * edit inserted a layer, reparented a host, changed a matte or resized the
 * slot, the digest differs and the operation fails closed rather than editing
 * something that is no longer the thing that was approved.
 *
 * NAMES ARE DELIBERATELY EXCLUDED. A rename changes nothing structural, and
 * failing an approved plan because a designer renamed a layer would be a false
 * alarm - the same reason names never decide a classification.
 */
export function computeSlotFingerprint(facts: SlotStructuralFacts): SlotFingerprint {
  const canonical = JSON.stringify([
    SLOT_FINGERPRINT_VERSION,
    facts.slotCompositionId,
    facts.slotLayerIndex,
    facts.widthPx,
    facts.heightPx,
    facts.hostDepth,
    facts.reusedByHostCount,
    facts.transformedBounds === null ? null : [facts.transformedBounds.widthPx, facts.transformedBounds.heightPx],
    facts.hosts.map((host) => [
      host.compositionId,
      host.layerIndex,
      host.threeDLayer,
      host.hasTrackMatte,
      host.trackMatteType,
      host.matteSource,
      host.parentLayerIndex,
      host.parentIsAnimated,
      host.siblingPreRenderedPass,
      host.scalePercent,
      host.rotationDegrees
    ])
  ]);
  return { version: SLOT_FINGERPRINT_VERSION, digest: sha256Hex(canonical) };
}

/** True only when both fingerprints were produced by the same version AND match exactly. A version change is itself a mismatch - never compared across rules. */
export function slotFingerprintsMatch(a: SlotFingerprint | null | undefined, b: SlotFingerprint | null | undefined): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined && a.version === b.version && a.digest === b.digest;
}

/* ------------------------------------------------------------------ *
 * Asset-to-slot compatibility.
 * ------------------------------------------------------------------ */

/**
 * What is known about the asset itself - MEASURED facts plus the role a human
 * declared. There is deliberately no filename field: a filename is a label,
 * not a fact about pixels, and it must never decide what an asset is.
 */
export const assetFactsSchema = z
  .object({
    /** The role a human chose in the plan (image / video / logo / phone_screen / unknown) - a decision, not an inference. */
    declaredRole: z.string().nullable(),
    widthPx: z.number().positive().nullable(),
    heightPx: z.number().positive().nullable(),
    /**
     * Whether the file's ENCODING can carry transparency. Evidence only - it
     * never decides anything, because an opaque screenshot exported as RGBA
     * and a palette image declaring a colour it never uses both set this.
     */
    hasAlphaChannel: z.boolean().nullable(),
    /**
     * Whether the picture ACTUALLY contains non-opaque pixels, measured by
     * decoding them. Null means the pixels could not be decoded - which is
     * neither "opaque" nor "transparent", and is resolved by a human rather
     * than by an assumption.
     */
    hasTransparentPixels: z.boolean().nullable(),
    /** The fraction of pixels that are not fully opaque, 0..1. Null when not measured. */
    transparentPixelRatio: z.number().min(0).max(1).nullable(),
    /** The fraction of the image that is visibly present, 0..1. Null when not measured. */
    visibleCoverageRatio: z.number().min(0).max(1).nullable(),
    /** Where the visible content actually sits inside the image, so transparent padding is not mistaken for content. Null when not measured. */
    visibleContentBounds: z
      .object({ xPx: z.number().nonnegative(), yPx: z.number().nonnegative(), widthPx: z.number().positive(), heightPx: z.number().positive() })
      .strict()
      .nullable()
  })
  .strict();
export type AssetFacts = z.infer<typeof assetFactsSchema>;

export const COMPATIBILITY_STATUSES = ["COMPATIBLE", "CONFLICT", "UNVERIFIABLE"] as const;
export const compatibilityStatusSchema = z.enum(COMPATIBILITY_STATUSES);
export type CompatibilityStatus = (typeof COMPATIBILITY_STATUSES)[number];

export const compatibilityFindingSchema = z.object({ code: z.string().min(1), detail: z.string().min(1), blocking: z.boolean() }).strict();
export type CompatibilityFinding = z.infer<typeof compatibilityFindingSchema>;

export const assetSlotCompatibilitySchema = z
  .object({
    status: compatibilityStatusSchema,
    findings: z.array(compatibilityFindingSchema),
    requiresHumanDecision: z.boolean(),
    reason: z.string().nullable()
  })
  .strict();
export type AssetSlotCompatibility = z.infer<typeof assetSlotCompatibilitySchema>;

/** Beyond this, the asset and the slot are shaped so differently that any fit does something drastic. */
const SEVERE_ASPECT_MISMATCH = 0.6;
/**
 * Below this share of see-through pixels, transparency is incidental - the
 * antialiased edge of a rounded screenshot corner, a stray soft edge - and is
 * not a transparent BACKGROUND. Above it, a device screen would genuinely show
 * through.
 */
export const SIGNIFICANT_TRANSPARENCY_RATIO = 0.02;
const NOTABLE_ASPECT_MISMATCH = 0.25;

/**
 * Judges whether an asset belongs in a slot, from declared role and MEASURED
 * facts only. Never sees a filename.
 */
export function assessAssetSlotCompatibility(
  slot: { classification: SlotClassification; widthPx: number | null; heightPx: number | null },
  asset: AssetFacts
): AssetSlotCompatibility {
  const findings: CompatibilityFinding[] = [];

  if (asset.declaredRole === null) {
    findings.push({ code: "ROLE_UNDECLARED", detail: "no role was chosen for this asset, so it cannot be checked against the slot", blocking: true });
  }
  if (asset.widthPx === null || asset.heightPx === null) {
    findings.push({ code: "ASSET_DIMENSIONS_UNKNOWN", detail: "this asset's real pixel dimensions are not known, so fit and coverage cannot be checked", blocking: true });
  }

  const role = asset.declaredRole;
  if (role === "logo" && slot.classification === "device_screen") {
    findings.push({
      code: "LOGO_INTO_DEVICE_SCREEN",
      detail: "a logo is mapped into a device screen - a screen normally shows app content, and a logo will sit on it as a floating mark",
      blocking: true
    });
  }
  // TRANSPARENCY IS JUDGED FROM PIXELS, NEVER FROM THE CONTAINER. An alpha
  // channel is a capability; what matters to a screen is whether the picture
  // actually has see-through areas, and how much of it they are. A few
  // antialiased edge pixels on a screenshot are not a transparent background.
  // Where transparency CHANGES WHAT A VIEWER SEES: a see-through picture on a
  // device screen shows the background through the phone, which is always
  // wrong. A decorative card is a different matter - an asset with or without
  // transparency both look intentional there, so an unmeasurable asset (a
  // video frame, a format this host cannot decode) is not held up over it.
  const transparencyMatters = slot.classification === "device_screen";
  const significantlyTransparent =
    asset.hasTransparentPixels === true && (asset.transparentPixelRatio === null || asset.transparentPixelRatio >= SIGNIFICANT_TRANSPARENCY_RATIO);

  if (transparencyMatters && asset.hasTransparentPixels === null) {
    findings.push({
      code: "ASSET_TRANSPARENCY_UNKNOWN",
      detail:
        asset.hasAlphaChannel === true
          ? "this asset's file can carry transparency but its pixels could not be read here, so whether it has a see-through background is unknown - look at it before deciding"
          : "whether this asset has any see-through areas could not be measured, so it cannot be checked against this slot",
      blocking: true
    });
  }
  if (significantlyTransparent && slot.classification === "device_screen") {
    findings.push({
      code: "TRANSPARENT_ASSET_INTO_DEVICE_SCREEN",
      detail:
        asset.transparentPixelRatio === null
          ? "this asset has see-through areas, which on a device screen show whatever is behind the phone through the screen"
          : `${Math.round(asset.transparentPixelRatio * 100)}% of this asset is see-through, which on a device screen shows whatever is behind the phone through the screen`,
      blocking: true
    });
  }
  if ((role === "image" || role === "phone_screen") && asset.hasTransparentPixels === false && slot.classification === "flat_card") {
    findings.push({
      code: "SCREENSHOT_INTO_FLAT_CARD",
      detail: "a full-bleed image (no see-through areas) is mapped into a decorative card - confirm this is meant to be a card and not the device screen",
      blocking: true
    });
  }
  if (asset.hasAlphaChannel === true && asset.hasTransparentPixels === false) {
    findings.push({
      code: "ALPHA_CHANNEL_UNUSED",
      detail: "this asset's file carries an alpha channel, but every pixel in it is opaque - it behaves as a solid image",
      blocking: false
    });
  }

  if (asset.widthPx !== null && asset.heightPx !== null && slot.widthPx !== null && slot.heightPx !== null) {
    const assetRatio = asset.widthPx / asset.heightPx;
    const slotRatio = slot.widthPx / slot.heightPx;
    const mismatch = Math.abs(assetRatio - slotRatio) / slotRatio;
    if (mismatch >= SEVERE_ASPECT_MISMATCH) {
      findings.push({
        code: "SEVERE_ASPECT_MISMATCH",
        detail: `the asset's shape (${assetRatio.toFixed(2)}:1) differs from the slot's (${slotRatio.toFixed(2)}:1) by ${Math.round(mismatch * 100)}% - any fit will crop or letterbox heavily`,
        blocking: true
      });
    } else if (mismatch >= NOTABLE_ASPECT_MISMATCH) {
      findings.push({
        code: "ASPECT_MISMATCH",
        detail: `the asset's shape differs from the slot's by ${Math.round(mismatch * 100)}%`,
        blocking: false
      });
    }
  }

  const blocking = findings.filter((finding) => finding.blocking);
  const unverifiable = blocking.some(
    (finding) => finding.code === "ROLE_UNDECLARED" || finding.code === "ASSET_DIMENSIONS_UNKNOWN" || finding.code === "ASSET_TRANSPARENCY_UNKNOWN"
  );
  const status: CompatibilityStatus = blocking.length === 0 ? "COMPATIBLE" : unverifiable ? "UNVERIFIABLE" : "CONFLICT";
  return {
    status,
    findings,
    requiresHumanDecision: blocking.length > 0,
    reason: blocking.length === 0 ? null : blocking.map((finding) => finding.detail).join("; ")
  };
}

/* ------------------------------------------------------------------ *
 * Fit validation.
 * ------------------------------------------------------------------ */

export const FIT_MODES = ["contain", "cover", "stretch"] as const;
export const fitModeSchema = z.enum(FIT_MODES);
export type FitMode = (typeof FIT_MODES)[number];

export const fitAssessmentSchema = z
  .object({
    mode: fitModeSchema,
    scaleXPercent: z.number().nullable(),
    scaleYPercent: z.number().nullable(),
    /** True when both axes are scaled identically - the only way an image keeps its shape. */
    uniform: z.boolean(),
    /** How much of the SLOT the asset covers, 0..100. */
    slotCoveragePercent: z.number().nullable(),
    /** How much of the ASSET is cut off by the slot's edges, 0..100. */
    assetCroppedPercent: z.number().nullable(),
    /** How much of the slot is left empty (letterboxing / a "raw rectangle" of background), 0..100. */
    unusedSlotAreaPercent: z.number().nullable(),
    /** How far the asset's shape is distorted, 0..100 - non-zero only for a stretch fit. */
    distortionPercent: z.number().nullable(),
    /**
     * How much of the slot the asset's VISIBLE CONTENT covers, 0..100 - the
     * number that decides whether a slot looks filled. Differs from
     * `slotCoveragePercent` exactly when the asset carries transparent
     * padding. Null when the asset's content bounds were never measured.
     */
    visibleContentCoveragePercent: z.number().nullable(),
    /** How much of the asset's VISIBLE CONTENT is cut off by the slot's edges, 0..100 - cropping empty padding costs nothing. Null when unmeasured. */
    visibleContentCroppedPercent: z.number().nullable(),
    flags: z.array(z.string()),
    /** False when this fit needs a human to look at it before approval. */
    safe: z.boolean(),
    reason: z.string().nullable()
  })
  .strict();
export type FitAssessment = z.infer<typeof fitAssessmentSchema>;

/** Beyond these, a fit is reported as unsafe and needs a look - chosen to catch the real failures (a stretched screenshot, a heavily cropped one, a card showing mostly background). */
export const FIT_LIMITS = { maxCroppedPercent: 35, maxUnusedAreaPercent: 25, maxDistortionPercent: 2, maxTransparentPaddingPercent: 30 } as const;

/**
 * Works out what a fit mode will actually DO to an asset in a slot: its scale
 * on each axis, how much of the slot it covers, how much of it is cropped away,
 * how much empty slot is left, and how distorted it ends up.
 *
 * Catches the "right layer, wrong fit" failures specifically: a stretched
 * screenshot (non-uniform scale), an over-cropped one, and a slot left mostly
 * empty - the raw-rectangle look of an image letterboxed into a card.
 */
export function assessFit(params: {
  slot: { widthPx: number | null; heightPx: number | null };
  asset: {
    widthPx: number | null;
    heightPx: number | null;
    /** Where the asset's visible content actually sits, when its pixels were measured. Transparent padding around it is not content. */
    visibleContentBounds?: { xPx: number; yPx: number; widthPx: number; heightPx: number } | null;
  };
  mode: FitMode;
}): FitAssessment {
  const { slot, asset, mode } = params;
  if (slot.widthPx === null || slot.heightPx === null || asset.widthPx === null || asset.heightPx === null) {
    return {
      mode,
      scaleXPercent: null,
      scaleYPercent: null,
      uniform: false,
      slotCoveragePercent: null,
      assetCroppedPercent: null,
      unusedSlotAreaPercent: null,
      distortionPercent: null,
      visibleContentCoveragePercent: null,
      visibleContentCroppedPercent: null,
      flags: ["DIMENSIONS_UNKNOWN"],
      safe: false,
      reason: "the slot's or the asset's real pixel dimensions are not known, so what this fit would do cannot be checked"
    };
  }

  const scaleToFitWidth = slot.widthPx / asset.widthPx;
  const scaleToFitHeight = slot.heightPx / asset.heightPx;
  const scaleX = mode === "stretch" ? scaleToFitWidth : mode === "cover" ? Math.max(scaleToFitWidth, scaleToFitHeight) : Math.min(scaleToFitWidth, scaleToFitHeight);
  const scaleY = mode === "stretch" ? scaleToFitHeight : scaleX;

  const renderedWidth = asset.widthPx * scaleX;
  const renderedHeight = asset.heightPx * scaleY;
  const visibleWidth = Math.min(renderedWidth, slot.widthPx);
  const visibleHeight = Math.min(renderedHeight, slot.heightPx);

  const slotArea = slot.widthPx * slot.heightPx;
  const renderedArea = renderedWidth * renderedHeight;
  const visibleArea = visibleWidth * visibleHeight;

  const slotCoveragePercent = (visibleArea / slotArea) * 100;
  const assetCroppedPercent = renderedArea === 0 ? 0 : ((renderedArea - visibleArea) / renderedArea) * 100;
  const unusedSlotAreaPercent = 100 - slotCoveragePercent;
  const distortionPercent = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY) * 100;

  // WHAT A VIEWER ACTUALLY SEES. When the asset's pixels were measured, its
  // visible content - not its file box - is what fills the slot and what gets
  // cropped: a logo padded with transparency "covers" the slot on paper while
  // leaving it visually empty, and cropping that padding costs nothing.
  const bounds = asset.visibleContentBounds ?? null;
  let visibleContentCoveragePercent: number | null = null;
  let visibleContentCroppedPercent: number | null = null;
  if (bounds !== null) {
    // The content's rectangle, scaled and centred exactly as the asset is.
    const offsetX = (slot.widthPx - renderedWidth) / 2;
    const offsetY = (slot.heightPx - renderedHeight) / 2;
    const contentLeft = offsetX + bounds.xPx * scaleX;
    const contentTop = offsetY + bounds.yPx * scaleY;
    const contentWidth = bounds.widthPx * scaleX;
    const contentHeight = bounds.heightPx * scaleY;
    const shownWidth = Math.max(0, Math.min(contentLeft + contentWidth, slot.widthPx) - Math.max(contentLeft, 0));
    const shownHeight = Math.max(0, Math.min(contentTop + contentHeight, slot.heightPx) - Math.max(contentTop, 0));
    const contentArea = contentWidth * contentHeight;
    const shownArea = shownWidth * shownHeight;
    visibleContentCoveragePercent = (shownArea / slotArea) * 100;
    visibleContentCroppedPercent = contentArea === 0 ? 0 : ((contentArea - shownArea) / contentArea) * 100;
  }

  // Measured content wins over the file's own box wherever it is known.
  const effectiveCoveragePercent = visibleContentCoveragePercent ?? slotCoveragePercent;
  const effectiveCroppedPercent = visibleContentCroppedPercent ?? assetCroppedPercent;
  const effectiveUnusedPercent = 100 - effectiveCoveragePercent;

  const flags: string[] = [];
  if (effectiveCroppedPercent > FIT_LIMITS.maxCroppedPercent) {
    flags.push("EXCESSIVE_CROP");
  }
  if (effectiveUnusedPercent > FIT_LIMITS.maxUnusedAreaPercent) {
    flags.push("LARGE_UNUSED_AREA");
  }
  if (visibleContentCoveragePercent !== null && slotCoveragePercent - visibleContentCoveragePercent > FIT_LIMITS.maxTransparentPaddingPercent) {
    flags.push("LARGE_TRANSPARENT_PADDING");
  }
  if (distortionPercent > FIT_LIMITS.maxDistortionPercent) {
    flags.push("DISTORTED");
  }

  const safe = flags.length === 0;
  const reasons: string[] = [];
  if (flags.includes("DISTORTED")) {
    reasons.push(`this fit stretches the asset out of shape by ${Math.round(distortionPercent)}%`);
  }
  if (flags.includes("EXCESSIVE_CROP")) {
    reasons.push(`this fit cuts away ${Math.round(effectiveCroppedPercent)}% of what the asset actually shows`);
  }
  if (flags.includes("LARGE_UNUSED_AREA")) {
    reasons.push(`this fit leaves ${Math.round(effectiveUnusedPercent)}% of the slot empty, so the slot's own background shows as a plain rectangle`);
  }
  if (flags.includes("LARGE_TRANSPARENT_PADDING")) {
    reasons.push(
      `this asset is mostly transparent padding - it fills ${Math.round(slotCoveragePercent)}% of the slot as a file, but only ${Math.round(
        visibleContentCoveragePercent ?? 0
      )}% of it actually shows anything`
    );
  }

  return {
    mode,
    scaleXPercent: scaleX * 100,
    scaleYPercent: scaleY * 100,
    uniform: Math.abs(scaleX - scaleY) < 1e-9,
    slotCoveragePercent,
    assetCroppedPercent,
    unusedSlotAreaPercent,
    distortionPercent,
    visibleContentCoveragePercent,
    visibleContentCroppedPercent,
    flags,
    safe,
    reason: safe ? null : reasons.join("; ")
  };
}

/* ------------------------------------------------------------------ *
 * Evidence frames.
 * ------------------------------------------------------------------ */

/**
 * Below this, a layer is on screen in name only - a held-at-zero or
 * nearly-faded-out frame proves nothing about what a slot contains.
 */
export const MIN_VISIBLE_OPACITY_PERCENT = 10;

/** Opacity at a moment, interpolated linearly between keyframes exactly as After Effects' own default easing would, and held flat outside them. */
function opacityAt(host: SlotHostFacts, timeSeconds: number): number | null {
  const keyframes = host.opacityKeyframes ?? null;
  if (keyframes === null || keyframes.length === 0) {
    return host.opacityPercentAtInPoint ?? null;
  }
  const sorted = [...keyframes].sort((a, b) => a.timeSeconds - b.timeSeconds);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (timeSeconds <= first.timeSeconds) {
    return first.valuePercent;
  }
  if (timeSeconds >= last.timeSeconds) {
    return last.valuePercent;
  }
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const next = sorted[index]!;
    if (timeSeconds <= next.timeSeconds) {
      const span = next.timeSeconds - previous.timeSeconds;
      if (span <= 0) {
        return next.valuePercent;
      }
      const ratio = (timeSeconds - previous.timeSeconds) / span;
      return previous.valuePercent + (next.valuePercent - previous.valuePercent) * ratio;
    }
  }
  return last.valuePercent;
}

/** The sub-window of a host's own window during which it is at a genuinely visible opacity. Null when there is none. */
function visibleOpacityWindow(host: SlotHostFacts, window: { startSeconds: number; endSeconds: number }): { startSeconds: number; endSeconds: number } | null {
  const keyframes = host.opacityKeyframes ?? null;
  if (keyframes === null || keyframes.length === 0) {
    // No animation: one constant opacity decides the whole window. An unread
    // opacity leaves the window as it is rather than inventing a fade.
    const constant = host.opacityPercentAtInPoint ?? null;
    return constant !== null && constant < MIN_VISIBLE_OPACITY_PERCENT ? null : window;
  }
  // Sample at the window's edges and at every keyframe inside it, then keep the
  // longest run that stays visible. Linear between keyframes means no visible
  // stretch can hide between two samples.
  const times = [window.startSeconds, window.endSeconds, ...keyframes.map((keyframe) => keyframe.timeSeconds)]
    .filter((time) => time >= window.startSeconds && time <= window.endSeconds)
    .sort((a, b) => a - b);
  let best: { startSeconds: number; endSeconds: number } | null = null;
  let runStart: number | null = null;
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index]!;
    const value = opacityAt(host, time);
    const visible = value === null || value >= MIN_VISIBLE_OPACITY_PERCENT;
    if (visible && runStart === null) {
      runStart = time;
    }
    const isLast = index === times.length - 1;
    if ((!visible || isLast) && runStart !== null) {
      const runEnd = visible ? time : times[index - 1] ?? runStart;
      if (best === null || runEnd - runStart > best.endSeconds - best.startSeconds) {
        best = { startSeconds: runStart, endSeconds: runEnd };
      }
      runStart = null;
    }
  }
  return best !== null && best.endSeconds > best.startSeconds ? best : null;
}

/**
 * WHEN THIS SLOT IS ACTUALLY ON SCREEN.
 *
 * Not "between its in and out points" - a layer can be switched off, held at
 * zero opacity, or transformed entirely outside the frame while its timing says
 * it is live. Each host contributes a window only if it is enabled, its
 * rendered rectangle reaches the frame at all, and its opacity stays visible;
 * the longest such window wins. Unread facts never disqualify a host (they are
 * unknown, not false), but a fact that is KNOWN to hide it does.
 *
 * Returns null when no host offers a provably visible window - which the gate
 * reports as "no visible moment" rather than capturing an arbitrary timestamp
 * and calling it evidence.
 */
export function computeEffectiveVisibility(
  facts: Pick<SlotStructuralFacts, "hosts" | "visibleWindowSeconds">,
  /**
   * When given, ONLY hosts living in this composition are considered.
   *
   * REAL 2026-09-25 DEFECT. A slot is usually placed by several hosts, and
   * each host's window is measured in ITS OWN composition's timeline. Those
   * numbers are not comparable, and an evidence frame is rendered in ONE
   * composition - the scene's. On a real template a slot had a host inside a
   * 60s helper composition (window 0-60) and a host in the 25.04s scene
   * (window 1.2-8.88); the longest-window rule picked 0-60 and produced an
   * evidence moment of 30s, which is past the end of the thing being
   * rendered. The captured frame was blank, and the approval gate accepted
   * it, because 30 really is inside 0-60.
   *
   * Callers rendering a specific composition must pass its id, so the moment
   * they get back is expressible in the timeline they will actually render.
   * Omitted, the behaviour is unchanged for callers that only want the
   * slot's own visibility regardless of where it is watched from.
   */
  inCompositionId?: string
): { startSeconds: number; endSeconds: number } | null {
  let best: { startSeconds: number; endSeconds: number } | null = null;
  for (const host of facts.hosts ?? []) {
    if (host.enabled === false || host.inFrame === false) {
      continue;
    }
    if (inCompositionId !== undefined && host.compositionId !== inCompositionId) {
      continue;
    }
    const window = host.windowSeconds ?? null;
    if (window === null || !(window.endSeconds > window.startSeconds)) {
      continue;
    }
    const visible = visibleOpacityWindow(host, window);
    if (visible !== null && (best === null || visible.endSeconds - visible.startSeconds > best.endSeconds - best.startSeconds)) {
      best = visible;
    }
  }
  if (best !== null) {
    return best;
  }
  // A manifest written before host-level visibility facts existed carries only
  // the raw window. It is used as-is rather than refusing every older project,
  // and it is the only path that still relies on timing alone - so it applies
  // ONLY when no host reported a window of its own. A host that was examined
  // and found switched off, off-frame or held invisible is a real answer, and
  // this must not talk it back into visibility.
  const examined = (facts.hosts ?? []).some(
    (host) => (inCompositionId === undefined || host.compositionId === inCompositionId) && (host.windowSeconds ?? null) !== null
  );
  if (examined) {
    return null;
  }

  const fallback = facts.visibleWindowSeconds ?? null;
  return fallback !== null && fallback.endSeconds > fallback.startSeconds ? fallback : null;
}

/**
 * A moment at which this slot is genuinely on screen, for the evidence frame
 * a human must see before deciding about it.
 *
 * The MIDDLE of the effectively-visible window, not of its in/out points: the
 * first frame of a layer is routinely mid-transition - faded out, sliding in,
 * or behind an animation - and a frame showing nothing proves nothing.
 */
export function selectEvidenceFrameSeconds(
  facts: Pick<SlotStructuralFacts, "hosts" | "visibleWindowSeconds">,
  /**
   * The composition the frame will actually be rendered in. Supplying it does
   * two things, and both matter - see computeEffectiveVisibility's own doc
   * comment for the real defect they prevent:
   *
   *  - only hosts living in that composition are considered, because a
   *    window measured in another composition's timeline is not a moment in
   *    this one;
   *  - the chosen moment must fall inside that composition's own duration.
   *    A manifest written before host-level facts existed carries only a
   *    whole-slot window with no composition attached, and that window can
   *    legitimately be longer than the thing being rendered. Rather than
   *    refuse every older project, the moment is bounded by what will
   *    actually exist on the timeline, and refused outright when even the
   *    start of the window lies past the end of it.
   */
  renderedIn?: { compositionId: string; durationSeconds: number }
): number | null {
  const window = computeEffectiveVisibility(facts, renderedIn?.compositionId);
  if (window === null) {
    return null;
  }
  const end = renderedIn === undefined ? window.endSeconds : Math.min(window.endSeconds, renderedIn.durationSeconds);
  if (!(end > window.startSeconds)) {
    return null;
  }
  return window.startSeconds + (end - window.startSeconds) / 2;
}

/**
 * A moment at which the GREATEST NUMBER of a scene's edited slots are on
 * screen at once, for the single preview frame a human approves the scene by
 * (CLAUDE.md approval gate "first designed frame").
 *
 * WHY THIS EXISTS (2026-09-22 smoke-test finding). EXECUTE_FRAME captured its
 * preview at t=0 unconditionally. A scene's layers routinely do not start at
 * t=0 - they are staggered, they fade in, they slide in - so the frame a
 * reviewer was asked to approve was frequently blank, or mid-transition.
 * Stage 4 had already established what "genuinely on screen" means for ONE
 * slot (`selectEvidenceFrameSeconds`); this is the same rule for the SET of
 * slots an execution actually touched.
 *
 * The rule, and why it is this rule: sweep the windows and take the interval
 * covered by the most of them - the moment showing the most of what was just
 * edited. Among equally-covered intervals the LONGEST wins (the steadiest
 * moment, furthest from any transition), and an exact tie is broken by taking
 * the earliest, so the answer is deterministic for a given set of windows.
 * The returned time is that interval's midpoint, for the same reason a single
 * slot's evidence frame is its window's midpoint rather than its start.
 *
 * Returns null when NO slot has a provable visible window - the caller then
 * keeps whatever default it had, rather than this function inventing a moment
 * out of nothing.
 */
export function selectScenePreviewFrameSeconds(
  windows: readonly ({ startSeconds: number; endSeconds: number } | null)[]
): number | null {
  const real = windows.filter((window): window is { startSeconds: number; endSeconds: number } => window !== null && window.endSeconds > window.startSeconds);
  if (real.length === 0) {
    return null;
  }
  const boundaries = [...new Set(real.flatMap((window) => [window.startSeconds, window.endSeconds]))].sort((a, b) => a - b);
  let best: { coverage: number; length: number; midpoint: number } | null = null;
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index] as number;
    const end = boundaries[index + 1] as number;
    if (!(end > start)) {
      continue;
    }
    const midpoint = start + (end - start) / 2;
    const coverage = real.filter((window) => window.startSeconds <= midpoint && midpoint < window.endSeconds).length;
    if (coverage === 0) {
      continue;
    }
    const length = end - start;
    // Strictly greater on both keys, so the earliest interval wins an exact
    // tie - the sweep visits them in ascending time order.
    if (best === null || coverage > best.coverage || (coverage === best.coverage && length > best.length)) {
      best = { coverage, length, midpoint };
    }
  }
  return best === null ? null : best.midpoint;
}

/* ------------------------------------------------------------------ *
 * The mutation-time fingerprint.
 * ------------------------------------------------------------------ */

/**
 * The facts of ONE hop in the nested chain an edit will traverse, as they can
 * be read back live from After Effects immediately before mutating.
 *
 * Deliberately a narrower set than `SlotStructuralFacts`: the full verdict
 * fingerprint covers hosts found anywhere in the project graph, which a
 * single live traversal cannot see. What CAN be re-read live is exactly the
 * chain about to be edited - and that is what must not have changed.
 */
export const slotChainHopSchema = z
  .object({
    compositionId: z.string().min(1),
    layerIndex: z.number().int().positive(),
    threeDLayer: z.boolean().nullable(),
    hasTrackMatte: z.boolean().nullable(),
    trackMatteType: z.string().nullable(),
    parentLayerIndex: z.number().int().nullable(),
    scalePercent: z.number().nullable(),
    rotationDegrees: z.number().nullable()
  })
  .strict();
export type SlotChainHop = z.infer<typeof slotChainHopSchema>;

/**
 * A digest of the chain an edit will traverse plus the target layer's own
 * geometry, recomputed from the LIVE project immediately before the mutation.
 *
 * If a later edit inserted a layer, reparented a hop, changed a matte, moved
 * the slot in 3D or resized it, this digest differs and the operation fails
 * closed - it refuses to edit something that is no longer the thing that was
 * approved. Names are excluded, for the same reason they never classify.
 */
export function computeSlotMutationFingerprint(params: {
  chain: readonly SlotChainHop[];
  targetLayerIndex: number;
  targetWidthPx: number | null;
  targetHeightPx: number | null;
}): SlotFingerprint {
  const canonical = JSON.stringify([
    SLOT_FINGERPRINT_VERSION,
    "mutation",
    params.targetLayerIndex,
    params.targetWidthPx,
    params.targetHeightPx,
    params.chain.map((hop) => [hop.compositionId, hop.layerIndex, hop.threeDLayer, hop.hasTrackMatte, hop.trackMatteType, hop.parentLayerIndex, hop.scalePercent, hop.rotationDegrees])
  ]);
  return { version: SLOT_FINGERPRINT_VERSION, digest: sha256Hex(canonical) };
}

/* ------------------------------------------------------------------ *
 * The human decision that clears a slot blocker.
 * ------------------------------------------------------------------ */

export const SLOT_REVIEW_DECISIONS = [
  /** The reviewer looked and confirms the classification and the mapping as they stand. */
  "ACCEPT",
  /** The reviewer says the structural verdict is wrong, and records what the slot actually is. */
  "OVERRIDE_CLASSIFICATION"
] as const;
export const slotReviewDecisionSchema = z.enum(SLOT_REVIEW_DECISIONS);
export type SlotReviewDecision = (typeof SLOT_REVIEW_DECISIONS)[number];

/**
 * One auditable reviewer decision about a slot, stored on the mapping.
 *
 * `evidenceDigest` is what makes it auditable rather than merely present: it
 * records exactly WHICH findings were on screen when the decision was made. A
 * new finding - a different classification, a new compatibility conflict, a
 * changed fit - produces a different digest, and the decision no longer
 * covers it. Silence never approves anything, and an old "yes" never covers a
 * new problem.
 */
export const slotReviewRecordSchema = z
  .object({
    decision: slotReviewDecisionSchema,
    /** Required for OVERRIDE_CLASSIFICATION: what the reviewer says this slot actually is. */
    classification: slotClassificationSchema.nullable(),
    decidedBy: z.string().min(1),
    decidedAt: z.string().datetime(),
    /** Digest of the findings this decision was made about - see evaluate-slot-readiness.ts. */
    evidenceDigest: z.string().length(64),
    /** The evidence frame the reviewer was shown, when one was required. */
    evidenceFrameStorageKey: z.string().min(1).nullable().default(null)
  })
  .strict();
export type SlotReviewRecord = z.infer<typeof slotReviewRecordSchema>;
