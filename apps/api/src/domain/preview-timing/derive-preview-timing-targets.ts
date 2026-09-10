import { MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST, MAX_PREVIEW_TIMING_CHAIN_TARGETS, type ScenePlanEntry } from "@dyo/schemas";

/** One distinct nested composition worth of layer-timing evidence to gather, and the specific layer indices within it that this scene's own real mappings actually address. */
export interface PreviewTimingTarget {
  compositionId: string;
  layerIndices: number[];
  /** True only for the single, optional "outer discovery" target (see this module's own doc comment) - requests EVERY plausible layer index rather than a set known in advance, since discovering which one hosts each mapping's own outermost composition IS the point of this target. */
  isOuterDiscovery?: true;
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
 * A real chain's own FIRST hop (e.g. comp-1, "Scene 1") is a layer
 * INSIDE `outerMostCompositionId` (e.g. comp-210, "!Render" - the scene's
 * own manifestCompositionId, always the true master/render timeline this
 * feature ultimately reports ranges against) - but a human mapping's
 * `humanNestedTarget` never itself records THAT outermost hop (it only
 * ever nests within whichever composition the mapping tool addressed
 * directly). When `outerMostCompositionId` differs from a chain's own
 * first hop, this returns ONE extra, PREPENDED "outer discovery" target
 * for `outerMostCompositionId` itself - requesting every layer index up
 * to MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST, since the real layer count of
 * a large master composition is not known ahead of time and the Worker's
 * own per-index `ae_get_layer` calls are already best-effort (an
 * out-of-range index is silently skipped, never a request failure - see
 * heroic-swan-scene-evidence-inspector.ts's own doc comment). The
 * resulting `layerDetails[]` (a FULL composition scan regardless of which
 * indices were requested - see buildInspectCompositionLayerDetailsScript)
 * lets a caller discover, from real evidence, which of those indices'
 * `sourceCompositionId` matches each chain's own first hop - never
 * guessed or assumed to be an identity/no-op placement.
 *
 * Same-composition mappings (`humanNestedTarget: null`, addressed via
 * `humanLayerIndex`/`manifestPlaceholderId` directly in the scene's own
 * top-level composition) contribute nothing here - that composition is
 * already what the EXISTING (non-preview-timing) INSPECT_SCENE_EVIDENCE
 * dispatch inspects.
 */
export function derivePreviewTimingTargets(scene: ScenePlanEntry, outerMostCompositionId: string): PreviewTimingTarget[] {
  const layerIndicesByCompositionId = new Map<string, Set<number>>();
  const orderedCompositionIds: string[] = [];
  let needsOuterDiscovery = false;

  for (const mapping of scene.mappings) {
    if (mapping.humanNestedTarget === null || mapping.humanNestedTarget.length === 0) {
      continue;
    }
    if (mapping.humanNestedTarget[0]!.compositionId !== outerMostCompositionId) {
      needsOuterDiscovery = true;
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

  const chainTargets = orderedCompositionIds.map((compositionId) => ({
    compositionId,
    layerIndices: [...(layerIndicesByCompositionId.get(compositionId) ?? [])].sort((a, b) => a - b)
  }));

  const targets: PreviewTimingTarget[] = needsOuterDiscovery
    ? [
        {
          compositionId: outerMostCompositionId,
          layerIndices: Array.from({ length: MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST }, (_, i) => i + 1),
          isOuterDiscovery: true
        },
        ...chainTargets
      ]
    : chainTargets;

  return targets.slice(0, MAX_PREVIEW_TIMING_CHAIN_TARGETS);
}
