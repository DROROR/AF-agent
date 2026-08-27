import type { ProjectBrandInputs, SceneEvidenceResponse, ScenePlanEntry, WorkMapEntry } from "@dyo/schemas";
import type { AssetRecord } from "../asset/types.js";
import type { MappingEvidenceBundle } from "./types.js";

export interface BuildEvidenceBundlesInput {
  scenePlans: ScenePlanEntry[];
  assets: AssetRecord[];
  /** Only `entries` is ever read - accepts a WorkMapRecord, a WorkMap DTO, or any object shaped this way, so callers never need to reshape one just to satisfy this parameter. */
  workMap: { entries: WorkMapEntry[] } | null;
  brandInputs: ProjectBrandInputs | null;
  /** Keyed by manifestCompositionId - always empty in production today (see types.ts's own doc comment on why); accepted as a parameter so a future persisted-evidence store can be wired in without changing this function's shape, and so tests can exercise the full pipeline with a real SceneEvidenceResponse. */
  sceneEvidenceByCompositionId?: Map<string, SceneEvidenceResponse>;
}

/**
 * Builds one evidence bundle per genuinely unresolved mapping target
 * (mapping-assistant phase section 2/4): a scene with zero detected
 * mappings gets exactly one scene-level bundle (mappingId: null); a scene
 * with mappings gets one bundle per mapping that doesn't already have a
 * selectedAssetId. An excluded scene (`use: false`) never gets a bundle -
 * it will never appear in the final output, so there is nothing to
 * suggest for it (mirrors getExecutionPlanReadiness's own "only used
 * scenes count" rule). Pure and deterministic: same inputs always
 * produce the same bundles in the same order.
 */
export function buildEvidenceBundles(input: BuildEvidenceBundlesInput): MappingEvidenceBundle[] {
  const bundles: MappingEvidenceBundle[] = [];
  const sceneEvidenceByCompositionId = input.sceneEvidenceByCompositionId ?? new Map<string, SceneEvidenceResponse>();

  for (const scene of input.scenePlans) {
    if (!scene.use) {
      continue;
    }

    const workMapEntry =
      input.workMap?.entries.find((entry) => entry.sourceCompositionId === scene.manifestCompositionId) ?? null;
    const sceneEvidence = sceneEvidenceByCompositionId.get(scene.manifestCompositionId) ?? null;

    const shared = {
      scenePlanId: scene.id,
      manifestCompositionId: scene.manifestCompositionId,
      compositionName: scene.compositionName,
      sourcePosition: scene.sourcePosition,
      sceneEvidence,
      workMapEntry,
      candidateAssets: input.assets,
      userInstructions: scene.instructions,
      brandInputs: input.brandInputs
    };

    if (scene.mappings.length === 0) {
      bundles.push({
        ...shared,
        mappingId: null,
        manifestPlaceholderId: null,
        placeholderName: null,
        currentClassification: null
      });
      continue;
    }

    for (const mapping of scene.mappings) {
      if (mapping.selectedAssetId !== null) {
        continue;
      }
      bundles.push({
        ...shared,
        mappingId: mapping.id,
        manifestPlaceholderId: mapping.manifestPlaceholderId,
        placeholderName: mapping.placeholderName,
        currentClassification: mapping.placeholderClassification.value
      });
    }
  }

  return bundles;
}
