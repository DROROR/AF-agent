import type { PlaceholderMapping, Placeholder, ScenePlanEntry, TemplateManifest } from "@dyo/schemas";
import { deterministicId } from "../../domain/execution-plan/deterministic-id.js";

const DETAIL_UNAVAILABLE_REASON_PATTERN = /did not return usable layer data/;

function buildMapping(placeholder: Placeholder, timestamp: string): PlaceholderMapping {
  return {
    id: deterministicId(["mapping", placeholder.placeholderId]),
    manifestPlaceholderId: placeholder.placeholderId,
    placeholderName: placeholder.layerName,
    placeholderClassification: {
      // "no invented semantic certainty": the manifest's own "unknown"
      // classification stays null here, never coerced into a guess.
      value: placeholder.placeholderType === "unknown" ? null : placeholder.placeholderType,
      source: "MANIFEST",
      evidence: [placeholder.evidence.reason]
    },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

/**
 * Deterministic TemplateManifest -> ScenePlanEntry[] builder (Phase 4
 * section 5). Every manifest composition is preserved - including the
 * composition-level-only ones ae_get_composition couldn't detail (they
 * get an empty mappings[] plus the manifest's own real unknownItems
 * reason carried forward, never silently dropped or re-derived
 * differently). Running this twice on the same manifest produces
 * identical output: every ID is a structural hash (deterministicId), and
 * `now` is the only side-channel input, threaded through explicitly
 * rather than read from the system clock internally.
 */
export function buildScenePlans(manifest: TemplateManifest, now: () => Date = () => new Date()): ScenePlanEntry[] {
  const timestamp = now().toISOString();

  return manifest.compositions.map((composition, compositionIndex): ScenePlanEntry => {
    const scene = manifest.scenes.find((s) => s.compositionId === composition.compositionId) ?? null;
    const placeholders = scene?.placeholders ?? [];
    const mappings = placeholders.map((p) => buildMapping(p, timestamp));

    const unresolvedReasons: string[] = [];
    if (!scene) {
      unresolvedReasons.push("composition is nested-only - not a candidate top-level scene");
    } else if (placeholders.length === 0) {
      const detailFailure = manifest.unknownItems.find(
        (u) => u.context === composition.name && DETAIL_UNAVAILABLE_REASON_PATTERN.test(u.reason)
      );
      unresolvedReasons.push(detailFailure ? detailFailure.reason : "no placeholder detected in this composition");
    } else if (mappings.every((m) => m.placeholderClassification.value === null)) {
      unresolvedReasons.push("no confident structural classification for any detected placeholder yet");
    }

    return {
      id: deterministicId(["scene-plan", composition.compositionId]),
      manifestCompositionId: composition.compositionId,
      compositionName: composition.name,
      // Conservative default: only a real candidate scene defaults to
      // included; a structurally-confirmed nested-only composition
      // defaults excluded. Never guessed from naming.
      use: scene !== null,
      sourcePosition: scene ? scene.originalOrderIndex : compositionIndex,
      // Output order starts equal to source order until a human reorders -
      // independent fields from this point on (Phase 4's own hard rule).
      finalOrder: scene ? scene.originalOrderIndex : compositionIndex,
      finalDuration: null,
      approvalState: "UNREVIEWED",
      instructions: null,
      notes: null,
      unresolvedReasons,
      evidence: [],
      mappings,
      // No Reels layout is ever inferred from the manifest - a human
      // configures it explicitly (SET_REELS_LAYOUT) once ready.
      reelsLayout: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  });
}
