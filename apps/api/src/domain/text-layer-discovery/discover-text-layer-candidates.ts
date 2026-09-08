import type { LayerDetailFact } from "@dyo/schemas";

/** One hop of a deterministic nested AE target - identical shape/semantics to NestedTargetStep (execution-plan.ts), ready to pass directly as an ADD_MAPPING's humanNestedTarget. */
export interface DiscoveredNestedTargetStep {
  compositionId: string;
  layerIndex: number;
}

/**
 * Live-QA "generic AE layer-discovery capability" requirement - one real,
 * evidence-based text layer found anywhere in the composition tree rooted
 * at `ownerCompositionId`. Never fabricated: every field traces directly
 * back to a `LayerDetailFact` this project's caller actually captured via
 * buildInspectCompositionLayerDetailsScript (see
 * heroic-swan-scene-evidence-inspector.ts).
 */
export interface DiscoveredTextLayerCandidate {
  /** The composition that actually contains this text layer. */
  compositionId: string;
  layerIndex: number;
  layerName: string;
  sourceText: string;
  /**
   * Null when `compositionId === ownerCompositionId` - the text layer lives
   * directly in the owning scene's own composition, so a same-composition
   * `humanLayerIndex: layerIndex` is the correct ADD_MAPPING target, not a
   * nested one. Otherwise a real, ordered root-to-leaf chain - each step's
   * `compositionId` is a genuine child (proven by this same discovery
   * walk's own PRECOMP evidence) of the previous step's `compositionId` (or
   * of `ownerCompositionId` for the first step) - exactly the shape
   * apply-execution-plan-edit.ts's verifyNestedTargetPath independently
   * re-verifies before ever accepting an ADD_MAPPING.
   */
  nestedTarget: DiscoveredNestedTargetStep[] | null;
  /**
   * True only when every composition on the path from `ownerCompositionId`
   * down to this candidate was actually reachable via real PRECOMP
   * evidence in `layerDetailsByCompositionId` - i.e. this candidate is
   * structurally part of the tree rooted at the owning composition. This
   * function only ever enumerates compositions it can reach that way, so
   * every returned candidate has this true by construction; kept as an
   * explicit field (rather than omitted) so a caller never has to
   * re-derive "was this actually reachable" from the shape of
   * `nestedTarget` alone. Deliberately NOT a claim about layer
   * enabled/opacity/time-range visibility at render time - this discovery
   * capability is read-only structural/text evidence, not a full
   * render-path simulation.
   */
  reachableFromOwner: true;
}

/**
 * Generic, template-agnostic composition-tree walk (live-QA "generic AE
 * layer-discovery capability" requirement - never hardcodes a composition
 * name/id/layer index; works against any manifest's own real composition
 * graph). Starts at `ownerCompositionId` and follows every real PRECOMP
 * layer (`layerType === "PRECOMP"`, `sourceCompositionId` non-null)
 * discovered in `layerDetailsByCompositionId` - the SAME per-layer
 * evidence buildInspectCompositionLayerDetailsScript produces - to reach
 * every nested composition, collecting every real TEXT layer
 * (`layerType === "TEXT"`, `sourceText` non-null) found anywhere along the
 * way.
 *
 * `layerDetailsByCompositionId` need only contain entries for
 * compositions the caller actually inspected (e.g. via one
 * INSPECT_SCENE_EVIDENCE job per scenePlanId with
 * `discoverLayerDetails: true`) - a composition with no entry (or an empty
 * one) simply contributes no further layers/children, it never fails the
 * whole walk.
 *
 * Cycle-safe: a composition already visited ALONG THE CURRENT PATH is
 * never re-entered (infinite-loop guard for a malformed/cyclic precomp
 * graph, which should not occur in a real AE project but is never
 * trusted blindly). A composition legitimately referenced from multiple
 * DIFFERENT parents (a real, common AE pattern - e.g. the same logo
 * precomp reused in two scenes) is still visited once per distinct path
 * that reaches it, so every real nested target chain is reported.
 */
export function discoverTextLayerCandidates(input: {
  ownerCompositionId: string;
  layerDetailsByCompositionId: Record<string, readonly LayerDetailFact[]>;
  /** Defensive bound on chain depth - default 20, generous for any real AE template, guards against a pathological/malformed graph. */
  maxDepth?: number;
}): DiscoveredTextLayerCandidate[] {
  const { ownerCompositionId, layerDetailsByCompositionId, maxDepth = 20 } = input;
  const candidates: DiscoveredTextLayerCandidate[] = [];

  function walk(compositionId: string, chainToParent: readonly DiscoveredNestedTargetStep[], visitedOnThisPath: ReadonlySet<string>, depth: number): void {
    if (depth > maxDepth || visitedOnThisPath.has(compositionId)) {
      return;
    }
    const nextVisited = new Set(visitedOnThisPath);
    nextVisited.add(compositionId);

    const layers = layerDetailsByCompositionId[compositionId] ?? [];
    for (const layer of layers) {
      if (layer.layerType === "TEXT" && layer.sourceText !== null) {
        const nestedTarget = compositionId === ownerCompositionId ? null : [...chainToParent, { compositionId, layerIndex: layer.layerIndex }];
        candidates.push({
          compositionId,
          layerIndex: layer.layerIndex,
          layerName: layer.layerName,
          sourceText: layer.sourceText,
          nestedTarget,
          reachableFromOwner: true
        });
      } else if (layer.layerType === "PRECOMP" && layer.sourceCompositionId !== null) {
        // A step is attributed to `compositionId` itself (never to the
        // owner - verified live against the real 4-hop App Logo chain: its
        // first step was {compositionId: "Scene 1" (a real child of the
        // owner), layerIndex: 3} - "layer 3 WITHIN Scene 1 points to
        // Pre-comp 3", never a step describing the owner's own layer that
        // referenced Scene 1 in the first place; verifyNestedTargetPath
        // (apply-execution-plan-edit.ts) only ever checks that each step's
        // compositionId is a real child of the PREVIOUS step's
        // compositionId, or of the owner for the first step - it is never
        // itself an explicit step).
        const childChain = compositionId === ownerCompositionId ? chainToParent : [...chainToParent, { compositionId, layerIndex: layer.layerIndex }];
        walk(layer.sourceCompositionId, childChain, nextVisited, depth + 1);
      }
    }
  }

  walk(ownerCompositionId, [], new Set(), 0);
  return candidates;
}

/**
 * Exact-codepoint match against a required Hebrew (or any Unicode) string -
 * live-QA correction: "Do NOT rely on visual RTL rendering." Compares the
 * full, logical Unicode codepoint sequence, never a byte/visual comparison,
 * so a reversed or otherwise-mangled candidate can never be mistaken for a
 * match.
 */
export function matchesRequiredText(candidate: DiscoveredTextLayerCandidate, requiredText: string): boolean {
  const candidateCodepoints = [...candidate.sourceText].map((c) => c.codePointAt(0));
  const requiredCodepoints = [...requiredText].map((c) => c.codePointAt(0));
  if (candidateCodepoints.length !== requiredCodepoints.length) {
    return false;
  }
  return candidateCodepoints.every((cp, i) => cp === requiredCodepoints[i]);
}
