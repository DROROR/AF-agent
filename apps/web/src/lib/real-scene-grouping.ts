import type { ScenePlanEntry, TemplateManifest } from "@dyo/schemas";

/**
 * One genuine, client-facing visual scene (client-facing UX redesign,
 * section B: "show REAL user-facing video scenes only; group nested AE
 * comps/placeholders under their real parent visual scene"). Built purely
 * from data the backend already produces - manifest.compositions[].
 * isNestedOnlyReferenced/parentCompositionIds and the existing
 * ScenePlanEntry list - never a new backend model. `nested` holds the
 * ScenePlanEntry rows for compositions that exist only as a helper/detail
 * inside this real scene (a phone-frame comp, a control-layer comp, ...);
 * they remain fully present in `nested` for Advanced mode, never deleted.
 */
export interface RealScene {
  manifestCompositionId: string;
  sceneName: string;
  scenePlan: ScenePlanEntry;
  nested: ScenePlanEntry[];
}

/**
 * Groups the plan's own ScenePlanEntry list (one per manifest composition)
 * into real, user-facing scenes only. A composition the manifest already
 * flags `isNestedOnlyReferenced` (the SAME signal the worker's own
 * buildTemplateManifest uses to build manifest.scenes) is never shown as
 * its own card - its ScenePlanEntry is attached under the first real-scene
 * ancestor found via `parentCompositionIds` instead. A nested-only
 * composition with no real-scene ancestor anywhere in the plan (should not
 * happen for a well-formed manifest, but never silently drops real
 * content) still surfaces as its own real scene rather than disappearing.
 */
export function groupIntoRealScenes(
  manifest: TemplateManifest,
  scenePlans: ScenePlanEntry[]
): RealScene[] {
  const compositionById = new Map(
    manifest.compositions.map((composition) => [composition.compositionId, composition])
  );

  const realScenes: RealScene[] = [];
  const realSceneByCompositionId = new Map<string, RealScene>();
  const nestedScenePlans: ScenePlanEntry[] = [];

  for (const scenePlan of scenePlans) {
    const composition = compositionById.get(scenePlan.manifestCompositionId);
    if (composition?.isNestedOnlyReferenced) {
      nestedScenePlans.push(scenePlan);
      continue;
    }
    const realScene: RealScene = {
      manifestCompositionId: scenePlan.manifestCompositionId,
      sceneName: scenePlan.compositionName,
      scenePlan,
      nested: []
    };
    realScenes.push(realScene);
    realSceneByCompositionId.set(scenePlan.manifestCompositionId, realScene);
  }

  // Two passes over the nested-only scenePlans: an orphan (no real-scene
  // ancestor) promoted to its own real scene in an earlier iteration must
  // never be mistaken for a genuine ancestor by a LATER scenePlan in this
  // same loop - only compositions that were real from the start (built
  // above, before this loop) are ever eligible attachment targets.
  const unattached: ScenePlanEntry[] = [];
  for (const scenePlan of nestedScenePlans) {
    const composition = compositionById.get(scenePlan.manifestCompositionId);
    const parentIds = composition?.parentCompositionIds ?? [];
    const parentRealScene = parentIds
      .map((id) => realSceneByCompositionId.get(id))
      .find((scene): scene is RealScene => Boolean(scene));
    if (parentRealScene) {
      parentRealScene.nested.push(scenePlan);
    } else {
      unattached.push(scenePlan);
    }
  }

  // No real-scene ancestor found anywhere in this plan - surface each as
  // its own real scene rather than silently hiding genuine content.
  for (const scenePlan of unattached) {
    realScenes.push({
      manifestCompositionId: scenePlan.manifestCompositionId,
      sceneName: scenePlan.compositionName,
      scenePlan,
      nested: []
    });
  }

  realScenes.sort((a, b) => a.scenePlan.sourcePosition - b.scenePlan.sourcePosition);
  return realScenes;
}
