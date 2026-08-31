import type { EvidenceRef, PlaceholderType } from "@dyo/schemas";
import type { MappingEvidenceBundle } from "../mapping-evidence/types.js";
import { resolveKeepOriginal } from "./structural-classification.js";

export interface DeterministicMatch {
  suggestedClassification: PlaceholderType | null;
  suggestedAssetId: string | null;
  suggestedText: string | null;
  suggestedAssetTimestamp: number | null;
  suggestedFinalDuration: number | null;
  confidence: number;
  reasoning: string | null;
  evidenceRefs: EvidenceRef[];
  unresolvedReason: string | null;
  requiresHumanReview: boolean;
  conflictsWithWorkMap: boolean;
}

const fact = (summary: string): EvidenceRef => ({ kind: "FACT", summary });
const userIntent = (summary: string): EvidenceRef => ({ kind: "USER_INTENT", summary });

/**
 * Deterministic evidence matching (mapping-assistant phase section 4) -
 * runs BEFORE any AI provider call, and only obvious, explicit, real
 * evidence ever produces a match here; anything requiring genuine
 * inference is left for the AI seam (or stays unknown if that is
 * unavailable/inconclusive too - see generate-mapping-suggestions.ts).
 * Rules are checked in priority order and the first that applies wins -
 * Work Map (explicit user intent) is checked first and always returns
 * immediately once it has an opinion, so it can never be silently
 * overridden by a lower-priority heuristic (section 11: Work Map outranks
 * inference). Returns null when nothing here applies - not a failure,
 * just "no deterministic answer".
 */
export function matchDeterministic(bundle: MappingEvidenceBundle): DeterministicMatch | null {
  const workMapEntry = bundle.workMapEntry;

  // Rule 1: Work Map explicitly names an asset for this scene.
  if (workMapEntry?.desiredAssetId) {
    const asset = bundle.candidateAssets.find((candidate) => candidate.id === workMapEntry.desiredAssetId);
    if (!asset) {
      return {
        suggestedClassification: null,
        suggestedAssetId: null,
        suggestedText: workMapEntry.desiredText,
        suggestedAssetTimestamp: workMapEntry.assetTimestampSeconds,
        suggestedFinalDuration: workMapEntry.desiredDurationSeconds,
        confidence: 0,
        reasoning: null,
        evidenceRefs: [userIntent(`Work Map names asset id "${workMapEntry.desiredAssetId}", which is not in this project's current Asset Catalog`)],
        unresolvedReason: "Work Map references an asset that no longer exists in this project's Asset Catalog - upload it again or update the Work Map",
        requiresHumanReview: true,
        conflictsWithWorkMap: true
      };
    }
    return {
      suggestedClassification: null,
      suggestedAssetId: asset.id,
      suggestedText: workMapEntry.desiredText,
      suggestedAssetTimestamp: workMapEntry.assetTimestampSeconds,
      suggestedFinalDuration: workMapEntry.desiredDurationSeconds,
      confidence: 1,
      reasoning: "The Work Map explicitly assigns this asset to this scene.",
      evidenceRefs: [userIntent(`Work Map entry for this scene names asset "${asset.label ?? asset.originalFilename}"`)],
      unresolvedReason: null,
      requiresHumanReview: false,
      conflictsWithWorkMap: false
    };
  }

  // Rule 2: Work Map has no asset opinion, but does have explicit desired text for this scene.
  if (workMapEntry?.desiredText) {
    return {
      suggestedClassification: null,
      suggestedAssetId: null,
      suggestedText: workMapEntry.desiredText,
      suggestedAssetTimestamp: workMapEntry.assetTimestampSeconds,
      suggestedFinalDuration: workMapEntry.desiredDurationSeconds,
      confidence: 1,
      reasoning: "The Work Map explicitly states the desired text for this scene.",
      evidenceRefs: [userIntent("Work Map entry for this scene states the desired text")],
      unresolvedReason: null,
      requiresHumanReview: false,
      conflictsWithWorkMap: false
    };
  }

  // Rule 2.5 (mapping-review deadlock fix, section A/B): a structural/
  // template-helper element (camera, mask, matte, shape layer, CONTROL,
  // phone-frame artwork, scene wrapper, ...) or a placeholder the client
  // has explicitly said to leave unchanged - resolved with NO replacement
  // and NO human review required, distinct from a genuine "nothing found"
  // null result. Runs strictly before Rule 4's risky filename-match
  // heuristic so an asset that happens to share a structural layer's name
  // is never auto-assigned to it (section E: "do not assign random
  // uploaded files to them"). classifyStructuralPlaceholder itself never
  // calls a recognized content target (Phone_screen, text, logo, ...)
  // structural, so this can never silently swallow a real content mapping
  // just because a sibling layer or the scene's own instructions mention
  // "keep unchanged" (section D/F).
  const keepOriginal = resolveKeepOriginal(bundle);
  if (keepOriginal.shouldKeepOriginal) {
    return {
      suggestedClassification: null,
      suggestedAssetId: null,
      suggestedText: null,
      suggestedAssetTimestamp: null,
      suggestedFinalDuration: null,
      confidence: 1,
      reasoning: "This is a structural/template element, or the client explicitly asked to keep it unchanged - no replacement is needed.",
      evidenceRefs: [fact(keepOriginal.reason ?? "Structural/template element")],
      unresolvedReason: null,
      requiresHumanReview: false,
      conflictsWithWorkMap: false
    };
  }

  // Rule 3: a manifest-classified logo placeholder + a project brand logo asset.
  if (bundle.currentClassification === "logo" && bundle.brandInputs?.logoAssetId) {
    const asset = bundle.candidateAssets.find((candidate) => candidate.id === bundle.brandInputs?.logoAssetId);
    if (asset) {
      return {
        suggestedClassification: "logo",
        suggestedAssetId: asset.id,
        suggestedText: null,
        suggestedAssetTimestamp: null,
        suggestedFinalDuration: null,
        confidence: 1,
        reasoning: "This placeholder is a manifest-classified logo slot, and the project has a brand logo asset set.",
        evidenceRefs: [
          fact("Manifest/current mapping classifies this placeholder as a logo"),
          userIntent("Project brand inputs name a logo asset")
        ],
        unresolvedReason: null,
        requiresHumanReview: false,
        conflictsWithWorkMap: false
      };
    }
  }

  // Rule 4: an asset's own label/filename exactly matches this placeholder's layer name - a real fact, but only a heuristic, so it still asks for extra scrutiny.
  if (bundle.placeholderName) {
    const needle = bundle.placeholderName.trim().toLowerCase();
    const asset = bundle.candidateAssets.find(
      (candidate) => candidate.label?.trim().toLowerCase() === needle || candidate.originalFilename.trim().toLowerCase() === needle
    );
    if (asset) {
      return {
        suggestedClassification: null,
        suggestedAssetId: asset.id,
        suggestedText: null,
        suggestedAssetTimestamp: null,
        suggestedFinalDuration: null,
        confidence: 0.75,
        reasoning: "An asset's label or filename exactly matches this placeholder's layer name.",
        evidenceRefs: [fact(`Asset "${asset.label ?? asset.originalFilename}" exactly matches layer name "${bundle.placeholderName}"`)],
        unresolvedReason: null,
        requiresHumanReview: true,
        conflictsWithWorkMap: false
      };
    }
  }

  return null;
}
