import type { ScenePlanEntry, TemplateManifest } from "@dyo/schemas";

/**
 * One genuine, client-facing visual scene (client-facing UX redesign,
 * section B, and the "LIVE UX ACCEPTANCE FAILED" follow-up fix). Built
 * purely from real, evidence-based manifest.compositions[].
 * parentCompositionIds facts (see buildInspectCompositionPrecompsScript on
 * the worker side - a composition only ever gets a parent here because
 * ANOTHER composition's own layers were confirmed, via a real AE property
 * read, to reference it as a precomp) plus the existing ScenePlanEntry
 * list - never a new backend model, never a name-pattern guess. `nested`
 * holds the ScenePlanEntry rows for every composition (at any depth) that
 * ultimately lives inside this real scene - a phone-frame comp, a
 * reusable text-treatment precomp, a logo precomp, ... - they remain
 * fully present in `nested` for Advanced mode, never deleted.
 */
export interface RealScene {
  manifestCompositionId: string;
  sceneName: string;
  scenePlan: ScenePlanEntry;
  nested: ScenePlanEntry[];
}

/**
 * Groups the plan's own ScenePlanEntry list (one per manifest
 * composition) into real, user-facing scenes only - a genuine, N-level
 * graph classification, not a single-hop "has a parent? hide : show"
 * rule (a template can bury real content several precomp levels deep -
 * e.g. Placeholder_1 inside Scene_03 inside Main Comp), and not a name
 * guess (nothing here ever reads a composition's own `name`).
 *
 * The graph, built purely from manifest.compositions[].
 * parentCompositionIds (real evidence, never guessed):
 * - A "root" is a composition nothing else references
 *   (parentCompositionIds is empty) - e.g. a master/output timeline like
 *   "Main Comp", or (for a template with no detected nesting at all -
 *   either genuinely flat, or a manifest captured before this capability
 *   existed) every composition, each with zero children.
 * - A root with TWO OR MORE direct children (compositions whose
 *   parentCompositionIds names that root) is a "sequence master" - a
 *   timeline built by placing several distinct precomps one after
 *   another. Its DIRECT CHILDREN are the real, client-facing scenes, not
 *   the master itself - though the master is still shown too if it
 *   carries real content of its own (an existing mapping), never
 *   silently dropped.
 * - A root with ZERO OR ONE direct child is itself the one real scene -
 *   either a flat, single-scene template, or a scene with a single
 *   decorative/structural helper composition nested inside it (e.g. a
 *   phone-frame precomp). This is also what makes an old, not-yet-
 *   re-inspected manifest (every parentCompositionIds still empty)
 *   degrade to exactly "one real scene per composition", the same
 *   behavior as before this graph existed.
 * - Anything else (a child of a non-scene composition, at any depth) is
 *   real CONTENT of whichever real-scene ancestor it descends from -
 *   walked up via parentCompositionIds, preferring a parent that is
 *   itself directly a real scene over one that requires walking further.
 * - A composition unreachable to any real scene (should not happen in a
 *   well-formed graph, but never silently drops real content) still
 *   surfaces as its own real scene.
 */
export function groupIntoRealScenes(manifest: TemplateManifest, scenePlans: ScenePlanEntry[]): RealScene[] {
  const compositionById = new Map(manifest.compositions.map((composition) => [composition.compositionId, composition]));
  const scenePlanByCompositionId = new Map(scenePlans.map((scenePlan) => [scenePlan.manifestCompositionId, scenePlan]));

  const directChildIdsByParentId = new Map<string, string[]>();
  for (const composition of manifest.compositions) {
    for (const parentId of composition.parentCompositionIds) {
      const children = directChildIdsByParentId.get(parentId) ?? [];
      children.push(composition.compositionId);
      directChildIdsByParentId.set(parentId, children);
    }
  }

  const roots = manifest.compositions.filter((composition) => composition.parentCompositionIds.length === 0);

  const sceneSeedIds = new Set<string>();
  for (const root of roots) {
    const directChildIds = directChildIdsByParentId.get(root.compositionId) ?? [];
    if (directChildIds.length >= 2) {
      for (const childId of directChildIds) {
        sceneSeedIds.add(childId);
      }
      const ownScenePlan = scenePlanByCompositionId.get(root.compositionId);
      if (ownScenePlan && ownScenePlan.mappings.length > 0) {
        sceneSeedIds.add(root.compositionId);
      }
    } else {
      sceneSeedIds.add(root.compositionId);
    }
  }

  // Real scene id -> its real scene's own manifestCompositionId, for
  // every composition reachable in the graph. Resolved once per
  // composition, memoized.
  const realSceneIdByCompositionId = new Map<string, string>();

  function resolveRealSceneId(compositionId: string, visiting: Set<string> = new Set()): string {
    const cached = realSceneIdByCompositionId.get(compositionId);
    if (cached) {
      return cached;
    }
    if (sceneSeedIds.has(compositionId)) {
      realSceneIdByCompositionId.set(compositionId, compositionId);
      return compositionId;
    }
    // Defends against a malformed/cyclic parentCompositionIds graph
    // (should never happen from real evidence, but never infinite-loops
    // or crashes on one).
    if (visiting.has(compositionId)) {
      return compositionId;
    }

    const parentIds = compositionById.get(compositionId)?.parentCompositionIds ?? [];
    if (parentIds.length === 0) {
      realSceneIdByCompositionId.set(compositionId, compositionId);
      return compositionId;
    }

    // Prefer any parent that is ITSELF directly a real scene over one
    // that would require walking further up - e.g. a layer reused inside
    // both a genuinely-nested helper AND a real scene should attach to
    // the real scene directly, not to the helper's own (deeper) ancestor.
    const directSceneParentId = parentIds.find((parentId) => sceneSeedIds.has(parentId));
    if (directSceneParentId) {
      realSceneIdByCompositionId.set(compositionId, directSceneParentId);
      return directSceneParentId;
    }

    visiting.add(compositionId);
    for (const parentId of parentIds) {
      const resolved = resolveRealSceneId(parentId, visiting);
      if (resolved) {
        visiting.delete(compositionId);
        realSceneIdByCompositionId.set(compositionId, resolved);
        return resolved;
      }
    }
    visiting.delete(compositionId);
    // No parent resolved (should not happen for a well-formed graph) -
    // never silently drop real content; this composition becomes its own
    // real scene instead.
    realSceneIdByCompositionId.set(compositionId, compositionId);
    return compositionId;
  }

  for (const composition of manifest.compositions) {
    resolveRealSceneId(composition.compositionId);
  }

  // A hidden sequence-master's own scenePlan produces no card and is
  // never a nesting target either - it was excluded from sceneSeedIds
  // specifically because it carries no real content of its own (see the
  // root-classification loop above), so there is nothing to lose by
  // never surfacing it.
  function isHiddenMaster(compositionId: string): boolean {
    const composition = compositionById.get(compositionId);
    if (!composition || composition.parentCompositionIds.length !== 0) {
      return false;
    }
    const directChildIds = directChildIdsByParentId.get(compositionId) ?? [];
    return directChildIds.length >= 2 && !sceneSeedIds.has(compositionId);
  }

  const realScenes: RealScene[] = [];
  const realSceneByCompositionId = new Map<string, RealScene>();

  for (const scenePlan of scenePlans) {
    if (isHiddenMaster(scenePlan.manifestCompositionId)) {
      continue;
    }
    const realSceneId = realSceneIdByCompositionId.get(scenePlan.manifestCompositionId) ?? scenePlan.manifestCompositionId;
    if (realSceneId !== scenePlan.manifestCompositionId) {
      continue;
    }
    if (realSceneByCompositionId.has(realSceneId)) {
      continue;
    }
    const realScene: RealScene = {
      manifestCompositionId: realSceneId,
      sceneName: scenePlan.compositionName,
      scenePlan,
      nested: []
    };
    realScenes.push(realScene);
    realSceneByCompositionId.set(realSceneId, realScene);
  }

  for (const scenePlan of scenePlans) {
    if (isHiddenMaster(scenePlan.manifestCompositionId)) {
      continue;
    }
    const realSceneId = realSceneIdByCompositionId.get(scenePlan.manifestCompositionId) ?? scenePlan.manifestCompositionId;
    if (realSceneId === scenePlan.manifestCompositionId) {
      continue;
    }
    const parentRealScene = realSceneByCompositionId.get(realSceneId);
    if (parentRealScene) {
      parentRealScene.nested.push(scenePlan);
      continue;
    }
    // The resolved real-scene ancestor has no scenePlan of its own
    // (should not happen - every manifest composition gets a
    // scenePlanEntry when the plan is built - but never silently hide
    // real content) - surface this composition as its own real scene
    // instead.
    const orphanScene: RealScene = {
      manifestCompositionId: scenePlan.manifestCompositionId,
      sceneName: scenePlan.compositionName,
      scenePlan,
      nested: []
    };
    realScenes.push(orphanScene);
    realSceneByCompositionId.set(scenePlan.manifestCompositionId, orphanScene);
  }

  realScenes.sort((a, b) => a.scenePlan.sourcePosition - b.scenePlan.sourcePosition);
  return realScenes;
}
