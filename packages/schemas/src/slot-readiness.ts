import { assessAssetSlotCompatibility, assessFit, selectEvidenceFrameSeconds, SLOT_SEMANTICS_MODEL_VERSION, type AssetSlotCompatibility, type FitAssessment, type FitMode, type SlotSemanticsResult } from "./slot-semantics.js";
import { sha256Hex } from "./text-digest.js";
import type { Placeholder, TemplateManifest } from "./template-manifest.js";
import type { PlaceholderMapping, ScenePlanEntry } from "./execution-plan.js";

/**
 * THE SLOT-SEMANTICS AND FIT GATE (Stage 4, 2026-09-19).
 *
 * Three questions, asked per mapping, all of them answerable only from facts:
 *
 *  1. WHAT IS THIS SLOT? A device screen or a flat card (slot-semantics.ts).
 *     A low-confidence or self-contradicting verdict blocks.
 *  2. DOES THIS ASSET BELONG IN IT? A logo does not belong in a phone screen,
 *     and a full-bleed screenshot does not silently belong in a decorative
 *     card. Judged from declared role and measured facts - never a filename.
 *  3. WILL IT ACTUALLY LOOK RIGHT? The chosen fit is simulated: a stretched,
 *     heavily cropped, or mostly-empty result blocks even when the layer and
 *     the asset are both correct.
 *
 * Every blocker is cleared the same way: an explicit, auditable human decision
 * recorded on the mapping, bound to a digest of exactly what was blocking. New
 * or different findings invalidate an old decision rather than inheriting it -
 * the same rule as the leftover-template-copy gate, for the same reason.
 */

export const SLOT_BLOCKER_KINDS = [
  /** The manifest carries no slot verdict at all (it predates Stage 4) - re-inspection is the fix. */
  "SLOT_SEMANTICS_MISSING",
  /** The verdict was produced by a different model version and cannot be compared under today's rules. */
  "SLOT_SEMANTICS_STALE_MODEL",
  /** Low confidence, unknown, or conflicting evidence. */
  "SLOT_CLASSIFICATION_UNCERTAIN",
  /** The asset does not belong in this slot. */
  "ASSET_SLOT_CONFLICT",
  /** The chosen fit distorts, over-crops, or leaves the slot mostly empty. */
  "UNSAFE_FIT"
] as const;
export type SlotBlockerKind = (typeof SLOT_BLOCKER_KINDS)[number];

export interface SlotBlocker {
  scenePlanId: string;
  sceneName: string;
  mappingId: string;
  placeholderName: string | null;
  kind: SlotBlockerKind;
  reason: string;
  /** Present when this mapping has a slot verdict at all - shown beside the blocker so a human sees the evidence, not just the refusal. */
  semantics: SlotSemanticsResult | null;
  compatibility: AssetSlotCompatibility | null;
  fit: FitAssessment | null;
  /** True when an evidence frame must exist before this can be resolved. */
  requiresEvidenceFrame: boolean;
  /** The moment, in the scene's own timeline, at which the slot is genuinely visible - null when no usable window is known, which is itself reported. */
  evidenceFrameAtSeconds: number | null;
  /** The whole window the slot is on screen. An evidence frame is only proof if it was captured inside it. Null when unknown. */
  evidenceFrameWindowSeconds: { startSeconds: number; endSeconds: number } | null;
}

/** The placeholder kinds that occupy a visual slot - the only ones a structural verdict is meaningful for. Mirrors build-manifest.ts's own rule for which placeholders get slot facts at all. */
const SLOT_PLACEHOLDER_TYPES = new Set(["image", "video", "logo", "phone_screen"]);

export interface SlotAssetFacts {
  id: string;
  widthPx: number | null;
  heightPx: number | null;
  /** Measured, not inferred. Null when nothing has measured it - alpha-dependent checks then simply do not fire. */
  hasAlpha: boolean | null;
}

/**
 * The fit a mapping will actually execute with, mirroring
 * resolve-execute-frame-dispatch.ts's own rule: a logo is contained so it is
 * never cropped, everything else covers the slot. Kept in one place so the
 * gate simulates exactly what execution will do.
 */
export function fitModeForRole(selectedAssetType: string | null): FitMode {
  return selectedAssetType === "logo" ? "contain" : "cover";
}

function placeholderFor(manifest: TemplateManifest, manifestPlaceholderId: string | null): Placeholder | null {
  if (manifestPlaceholderId === null) {
    return null;
  }
  for (const scene of manifest.scenes) {
    for (const placeholder of scene.placeholders) {
      if (placeholder.placeholderId === manifestPlaceholderId) {
        return placeholder;
      }
    }
  }
  return null;
}

/**
 * A digest of exactly what is blocking, so a recorded decision is bound to the
 * findings it was made about. Any new, removed or changed finding produces a
 * different digest, which makes an older decision stale instead of letting it
 * silently cover something the human never saw.
 */
export function slotEvidenceDigest(findings: {
  semantics: SlotSemanticsResult | null;
  compatibility: AssetSlotCompatibility | null;
  fit: FitAssessment | null;
}): string {
  return sha256Hex(
    JSON.stringify([
      findings.semantics === null
        ? null
        : [findings.semantics.modelVersion, findings.semantics.classification, Math.round(findings.semantics.confidence * 1000), findings.semantics.conflicting],
      findings.compatibility === null ? null : [findings.compatibility.status, findings.compatibility.findings.map((finding) => finding.code).sort()],
      findings.fit === null ? null : [findings.fit.mode, [...findings.fit.flags].sort()]
    ])
  );
}

export interface SlotAssessment {
  semantics: SlotSemanticsResult | null;
  compatibility: AssetSlotCompatibility | null;
  fit: FitAssessment | null;
  blockers: SlotBlocker[];
}

/** Assesses one mapping against its own slot. Pure - every input is already-read state. */
export function assessMappingSlot(params: {
  scene: ScenePlanEntry;
  mapping: PlaceholderMapping;
  manifest: TemplateManifest;
  asset: SlotAssetFacts | null;
}): SlotAssessment {
  const { scene, mapping, manifest, asset } = params;
  const blockers: SlotBlocker[] = [];
  const base = { scenePlanId: scene.id, sceneName: scene.compositionName, mappingId: mapping.id, placeholderName: mapping.placeholderName };

  // Only a mapping that actually places an asset has a slot question to answer.
  if (mapping.selectedAssetId === null) {
    return { semantics: null, compatibility: null, fit: null, blockers: [] };
  }

  const placeholder = placeholderFor(manifest, mapping.manifestPlaceholderId);

  // Only a VISUAL SLOT has a structural question to answer. A text line or a
  // colour swatch is not a window into anything, so an asset attached to one
  // (a logo recorded against a brand line, say) is not judged here - and is
  // never blocked waiting for a verdict that could not exist.
  if (placeholder !== null && !SLOT_PLACEHOLDER_TYPES.has(placeholder.placeholderType)) {
    return { semantics: null, compatibility: null, fit: null, blockers: [] };
  }

  const semantics = placeholder?.slotSemantics ?? null;
  const slotFacts = placeholder?.slotFacts ?? null;

  if (placeholder === null || semantics === null) {
    // A human-added mapping with no manifest placeholder has no slot to judge;
    // a manifest-linked one with no verdict genuinely needs re-inspection.
    if (mapping.manifestPlaceholderId === null) {
      return { semantics: null, compatibility: null, fit: null, blockers: [] };
    }
    blockers.push({
      ...base,
      kind: "SLOT_SEMANTICS_MISSING",
      reason:
        "this project's manifest records no structural verdict for this image slot, so it cannot be checked for being a device screen or a decorative card - re-run template inspection for this project before approving or executing",
      semantics: null,
      compatibility: null,
      fit: null,
      requiresEvidenceFrame: false,
      evidenceFrameAtSeconds: null,
      evidenceFrameWindowSeconds: null
    });
    return { semantics: null, compatibility: null, fit: null, blockers };
  }

  if (semantics.modelVersion !== SLOT_SEMANTICS_MODEL_VERSION) {
    blockers.push({
      ...base,
      kind: "SLOT_SEMANTICS_STALE_MODEL",
      reason: `this slot's verdict was produced by an older classifier (${semantics.modelVersion}, now ${SLOT_SEMANTICS_MODEL_VERSION}) and cannot be compared under today's rules - re-run template inspection for this project`,
      semantics,
      compatibility: null,
      fit: null,
      requiresEvidenceFrame: false,
      evidenceFrameAtSeconds: null,
      evidenceFrameWindowSeconds: null
    });
    return { semantics, compatibility: null, fit: null, blockers };
  }

  // The moment a human must be shown before deciding. Null means the slot
  // never presents a provable visible moment, which the reasons below say
  // plainly rather than capturing an arbitrary frame.
  const evidenceFrameAtSeconds = slotFacts === null ? null : selectEvidenceFrameSeconds(slotFacts);
  const evidenceFrameWindowSeconds = evidenceFrameAtSeconds === null ? null : (slotFacts?.visibleWindowSeconds ?? null);

  if (semantics.requiresHumanDecision) {
    blockers.push({
      ...base,
      kind: "SLOT_CLASSIFICATION_UNCERTAIN",
      reason: semantics.reason ?? "this slot's classification is not confident enough to act on",
      semantics,
      compatibility: null,
      fit: null,
      requiresEvidenceFrame: true,
      evidenceFrameWindowSeconds,
      evidenceFrameAtSeconds
    });
  }

  const slotSize = { widthPx: slotFacts?.widthPx ?? null, heightPx: slotFacts?.heightPx ?? null };
  const compatibility = assessAssetSlotCompatibility(
    { classification: semantics.classification, ...slotSize },
    { declaredRole: mapping.selectedAssetType, widthPx: asset?.widthPx ?? null, heightPx: asset?.heightPx ?? null, hasAlpha: asset?.hasAlpha ?? null }
  );
  if (compatibility.requiresHumanDecision) {
    blockers.push({
      ...base,
      kind: "ASSET_SLOT_CONFLICT",
      reason: compatibility.reason ?? "this asset does not fit this slot's purpose",
      semantics,
      compatibility,
      fit: null,
      requiresEvidenceFrame: true,
      evidenceFrameWindowSeconds,
      evidenceFrameAtSeconds
    });
  }

  const fit = assessFit({ slot: slotSize, asset: { widthPx: asset?.widthPx ?? null, heightPx: asset?.heightPx ?? null }, mode: fitModeForRole(mapping.selectedAssetType) });
  if (!fit.safe) {
    blockers.push({
      ...base,
      kind: "UNSAFE_FIT",
      reason: fit.reason ?? "this fit would not render correctly",
      semantics,
      compatibility,
      fit,
      requiresEvidenceFrame: true,
      evidenceFrameWindowSeconds,
      evidenceFrameAtSeconds
    });
  }

  return { semantics, compatibility, fit, blockers };
}

/**
 * Every unresolved slot blocker across the scenes actually marked for use.
 *
 * A blocker is resolved ONLY by an explicit decision recorded on that mapping
 * whose `evidenceDigest` matches what is blocking right now. A decision made
 * about different findings is stale and does not clear anything.
 */
export function findSlotBlockers(scenePlans: readonly ScenePlanEntry[], manifest: TemplateManifest, assetsById: ReadonlyMap<string, SlotAssetFacts>): SlotBlocker[] {
  const blockers: SlotBlocker[] = [];
  for (const scene of scenePlans) {
    if (!scene.use) {
      continue;
    }
    for (const mapping of scene.mappings) {
      const asset = mapping.selectedAssetId === null ? null : (assetsById.get(mapping.selectedAssetId) ?? null);
      const assessment = assessMappingSlot({ scene, mapping, manifest, asset });
      if (assessment.blockers.length === 0) {
        continue;
      }
      const review = mapping.slotReview ?? null;
      const currentDigest = slotEvidenceDigest(assessment);
      const resolved = review !== null && review.evidenceDigest === currentDigest;
      if (!resolved) {
        blockers.push(
          ...assessment.blockers.map((blocker) =>
            review === null
              ? blocker
              : { ...blocker, reason: `${blocker.reason} (the recorded decision was made about different findings, so it no longer covers this)` }
          )
        );
      }
    }
  }
  return blockers;
}

/** One human-readable line per blocker, naming the scene and layer so an operator can act without opening the database. */
export function describeSlotBlockers(blockers: readonly SlotBlocker[]): string[] {
  return blockers.map((blocker) => `${blocker.sceneName} / ${blocker.placeholderName ?? blocker.mappingId} [${blocker.kind}]: ${blocker.reason}`);
}
