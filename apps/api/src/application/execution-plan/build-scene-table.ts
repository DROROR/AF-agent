import type { SceneTableRow, ScenePlanEntry } from "@dyo/schemas";

/**
 * Flattens the persisted hierarchical plan (Composition -> ScenePlanEntry
 * -> zero/many PlaceholderMapping) into the Dynamic Scene Table contract
 * (Phase 4 section 8 / docs/PHASES.md's Phase 4 column list): one row per
 * mapping, plus one row per scene with zero mappings (mappingId: null) so
 * a composition-level-only scene is still visible, never dropped from the
 * table. Pure read-side projection - editing always goes through the
 * typed operations in execution-plan-edit.ts, never by writing this shape
 * back.
 */
export function buildSceneTable(scenePlans: readonly ScenePlanEntry[]): SceneTableRow[] {
  const rows: SceneTableRow[] = [];

  for (const scene of scenePlans) {
    if (scene.mappings.length === 0) {
      rows.push({
        scenePlanId: scene.id,
        mappingId: null,
        use: scene.use,
        sourcePosition: scene.sourcePosition,
        finalOrder: scene.finalOrder,
        compositionName: scene.compositionName,
        placeholderLabel: null,
        placeholderClassification: null,
        selectedAssetId: null,
        selectedAssetType: null,
        text: null,
        assetTimestamp: null,
        finalDuration: scene.finalDuration,
        approvalState: scene.approvalState,
        notes: scene.notes,
        instructions: scene.instructions,
        unresolvedReasons: scene.unresolvedReasons
      });
      continue;
    }

    for (const mapping of scene.mappings) {
      rows.push({
        scenePlanId: scene.id,
        mappingId: mapping.id,
        use: scene.use,
        sourcePosition: scene.sourcePosition,
        finalOrder: scene.finalOrder,
        compositionName: scene.compositionName,
        placeholderLabel: mapping.placeholderName,
        placeholderClassification: mapping.placeholderClassification,
        selectedAssetId: mapping.selectedAssetId,
        selectedAssetType: mapping.selectedAssetType,
        text: mapping.text,
        assetTimestamp: mapping.assetTimestamp,
        finalDuration: scene.finalDuration,
        approvalState: scene.approvalState,
        notes: scene.notes,
        instructions: scene.instructions,
        unresolvedReasons: scene.unresolvedReasons
      });
    }
  }

  return rows;
}
