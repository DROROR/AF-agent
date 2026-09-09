import type { ScenePlanEntry } from "@dyo/schemas";

/** One distinct nested composition worth of layer-timing evidence to gather, and the specific layer indices within it that this scene's own real mappings actually address. */
export interface PreviewTimingTarget {
  compositionId: string;
  layerIndices: number[];
}

/**
 * Preview Timing Analysis (live QA, 2026-09-09 real incident: a First
 * Preview kept landing on frames before the mapped logo/Hebrew branding
 * ever became visible, and no stored evidence existed to calculate a
 * better timestamp from). Generic, template-agnostic (never hardcodes a
 * composition id/layer index - reads them from THIS scene's own real,
 * approved `humanNestedTarget` chains): collects the first TWO hops of
 * every mapping's own nested target chain, grouped by compositionId, in
 * first-seen order.
 *
 * Deliberately bounded to two hops rather than walking every mapping's
 * full chain depth (a real logo mapping here is
 * comp-1[3] -> comp-1635[1] -> comp-1044[1] -> comp-1113[1], four hops
 * deep): the innermost precomps (App Emblem/App Logo) are themselves
 * simple, single-purpose asset wrappers whose own layer typically spans
 * their full native duration and is very unlikely to be the binding
 * constraint on when content becomes visible on the master timeline -
 * the OUTER wrapper (the layer that determines when the whole nested
 * branch is even active) and the layer immediately inside it (where a
 * logo's own timing can genuinely differ from an adjacent Hebrew text
 * layer in the SAME parent composition, as here: comp-1635 layer 1 vs
 * layer 4) are what actually matter for a representative-frame decision.
 * A future caller needing deeper evidence can extend `maxHops`.
 *
 * Same-composition mappings (`humanNestedTarget: null`, addressed via
 * `humanLayerIndex`/`manifestPlaceholderId` directly in the scene's own
 * top-level composition) contribute nothing here - that composition is
 * already what the EXISTING (non-preview-timing) INSPECT_SCENE_EVIDENCE
 * dispatch inspects.
 */
export function derivePreviewTimingTargets(scene: ScenePlanEntry, maxHops = 2): PreviewTimingTarget[] {
  const layerIndicesByCompositionId = new Map<string, Set<number>>();
  const orderedCompositionIds: string[] = [];

  for (const mapping of scene.mappings) {
    if (mapping.humanNestedTarget === null) {
      continue;
    }
    for (const step of mapping.humanNestedTarget.slice(0, maxHops)) {
      let layerIndices = layerIndicesByCompositionId.get(step.compositionId);
      if (!layerIndices) {
        layerIndices = new Set();
        layerIndicesByCompositionId.set(step.compositionId, layerIndices);
        orderedCompositionIds.push(step.compositionId);
      }
      layerIndices.add(step.layerIndex);
    }
  }

  return orderedCompositionIds.map((compositionId) => ({
    compositionId,
    layerIndices: [...(layerIndicesByCompositionId.get(compositionId) ?? [])].sort((a, b) => a - b)
  }));
}
