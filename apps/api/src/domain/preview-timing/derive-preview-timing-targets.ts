import { MAX_PREVIEW_TIMING_CHAIN_TARGETS, type ScenePlanEntry } from "@dyo/schemas";

/** One distinct nested composition worth of layer-timing evidence to gather, and the specific layer indices within it that this scene's own real mappings actually address. */
export interface PreviewTimingTarget {
  compositionId: string;
  layerIndices: number[];
}

/**
 * Preview Timing Analysis (live QA, 2026-09-09 real incident: a First
 * Preview kept landing on frames before the mapped logo/Hebrew branding
 * ever became visible, and no stored evidence existed to calculate a
 * better timestamp from; extended 2026-09-10 after a SECOND real incident
 * proved the original two-hop-only scope was itself the reason a
 * recommended timestamp still didn't show real content - a real logo
 * mapping here nests FOUR hops deep, comp-1[3] -> comp-1635[1] ->
 * comp-1044[1] -> comp-1113[1], and the third/fourth hops were never
 * being measured at all).
 *
 * Generic, template-agnostic (never hardcodes a composition id/layer
 * index - reads them from THIS scene's own real, approved
 * `humanNestedTarget` chains, at whatever depth they actually go):
 * collects EVERY hop of every mapping's own nested target chain, grouped
 * by compositionId, in first-seen order, bounded only by
 * MAX_PREVIEW_TIMING_CHAIN_TARGETS (a generous safety bound - see its own
 * doc comment - never a real scope limit for any real template).
 *
 * Does NOT resolve how a chain's own first hop (e.g. "Scene 1") is
 * itself placed inside the scene's real master/render composition (e.g.
 * "!Render") - a mapping's own `humanNestedTarget` never records that
 * (see 2026-09-10's own real incident: it is not always a single direct
 * hop, and finding the real path requires an ADAPTIVE graph search this
 * function cannot precompute). That discovery is a SEPARATE, dynamic
 * mechanism (previewTimingDiscoverCompositionId - see job-dispatch.ts's
 * own doc comment), driven by the caller across multiple round trips,
 * each one informed by the previous step's own real evidence.
 *
 * Same-composition mappings (`humanNestedTarget: null`, addressed via
 * `humanLayerIndex`/`manifestPlaceholderId` directly in the scene's own
 * top-level composition) contribute nothing here - that composition is
 * already what the EXISTING (non-preview-timing) INSPECT_SCENE_EVIDENCE
 * dispatch inspects.
 */
export function derivePreviewTimingTargets(scene: ScenePlanEntry): PreviewTimingTarget[] {
  const layerIndicesByCompositionId = new Map<string, Set<number>>();
  const orderedCompositionIds: string[] = [];

  for (const mapping of scene.mappings) {
    if (mapping.humanNestedTarget === null) {
      continue;
    }
    for (const step of mapping.humanNestedTarget) {
      let layerIndices = layerIndicesByCompositionId.get(step.compositionId);
      if (!layerIndices) {
        layerIndices = new Set();
        layerIndicesByCompositionId.set(step.compositionId, layerIndices);
        orderedCompositionIds.push(step.compositionId);
      }
      layerIndices.add(step.layerIndex);
    }
  }

  return orderedCompositionIds.slice(0, MAX_PREVIEW_TIMING_CHAIN_TARGETS).map((compositionId) => ({
    compositionId,
    layerIndices: [...(layerIndicesByCompositionId.get(compositionId) ?? [])].sort((a, b) => a - b)
  }));
}
