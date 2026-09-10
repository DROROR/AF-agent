/**
 * Preview Timing Analysis (live QA, 2026-09-09/10 real incidents) -
 * calculates exactly when nested branding content becomes visible on the
 * OUTER (!Render-absolute) composition's own timeline, from real,
 * worker-captured evidence - never a guess, never an average scene
 * duration.
 *
 * 2026-09-10 extension: the original version only ever measured a SINGLE
 * nesting hop (a mapping's own wrapper layer + the layer immediately
 * inside it), bounded to two hops total. A real incident (session
 * a7fee3d9, recommended timestamp 4.93827160493827s) proved that scope
 * was itself the problem: the real logo mapping here nests FOUR hops deep
 * (!Render -> Scene 1 -> Pre-comp 3 -> App Emblem -> App Logo), and the
 * un-measured third/fourth hops meant the "logo" range this module
 * reported was actually just App Emblem's own wrapper window, not the
 * real App Logo layer's own, possibly narrower, visible range. This
 * module now walks a mapping's COMPLETE `humanNestedTarget` chain, at
 * whatever depth it actually goes, composing the real AE nested-
 * composition time-mapping formula through every hop:
 *
 * for a layer L living inside composition C, L's own inPoint/outPoint/
 * startTime are all expressed in C's own timeline. If C itself is placed
 * as a layer P inside an OUTER composition, C's own local time 0
 * corresponds to the outer composition's time = P.startTime, and C's
 * local time T corresponds to outer time = P.startTime + T * (P.stretch/100).
 * A leaf layer nested inside C is therefore visible in the OUTER
 * composition's timeline during the intersection of that mapped window
 * with P's own visible window there ([P.inPoint, P.outPoint]) - nothing
 * nested inside P can ever be visible outside P's own presence. Applied
 * once per hop, walking from the leaf outward to the true master
 * timeline.
 *
 * Also new in this extension: a layer's real, confirmed opacity is now
 * part of the visibility calculation, not merely collected evidence a
 * consumer had to remember to check separately (the exact OTHER half of
 * the 2026-09-10 incident - a recommended timestamp fell inside a text
 * layer's own inPoint/outPoint window, but its real opacity was 0
 * throughout). A STATIC opacity of 0 excludes a layer's window entirely;
 * an ANIMATED opacity (real keyframes, never a single sampled value)
 * contributes only the real sub-intervals where the PIECEWISE-LINEAR
 * interpolation between consecutive keyframes is greater than 0 (see
 * `opacityVisibleIntervals`'s own doc comment for the one documented
 * assumption this makes, and why it's safe for interval SIGN even though
 * it doesn't reproduce AE's exact easing curve).
 *
 * Deliberately refuses (never silently proceeds with a wrong number)
 * when:
 *   - any hop's own time remapping is enabled - real time-remap
 *     keyframes are non-linear and this worker has no keyframe evidence,
 *     only whether remapping is on at all (see jsx-templates.ts's own
 *     doc comment on why that's all the real, allowlisted ae_run_jsx
 *     channel can honestly report).
 *   - any hop's own layer, leaf included, is disabled.
 *   - any hop's own confirmed opacity is 0 throughout its own window
 *     (static, or animated with every interval evaluating to 0).
 *   - a hop's own mapped window never actually overlaps its wrapper's
 *     visible window (it could never be visible at any timestamp).
 *   - real timing evidence for a required hop is missing entirely (a
 *     Worker/evidence gap, not a "nothing to see" - see
 *     resolvePreviewTimingChains's own doc comment).
 */

import type { HostLayerRecord, LayerDetailFact, LayerEvidence, PlaceholderMapping, SceneEvidenceResponse } from "@dyo/schemas";

export type Range = [number, number];

export interface LayerWindow {
  layerIndex: number;
  enabled: boolean;
  inPointSeconds: number;
  outPointSeconds: number;
  startTimeSeconds: number;
}

/** Mirrors LayerDetailFact's own opacityStatic/opacityKeyframes - mutually exclusive, both null only when the property could not be read at all. */
export interface OpacityFact {
  staticPercent: number | null;
  keyframes: { timeSeconds: number; valuePercent: number }[] | null;
}

/** One hop's own complete real evidence - a layer inside SOME composition, whose own window/stretch/timeRemap/opacity are all expressed in THAT composition's own timeline. */
export interface ChainHop {
  compositionId: string;
  window: LayerWindow;
  stretchPercent: number | null;
  timeRemapEnabled: boolean | null;
  opacity: OpacityFact | null;
}

/**
 * One chain position's real CANDIDATE hop(s) (live QA, 2026-09-10, targeted
 * host-layer lookup extension): a child composition can be placed at
 * MULTIPLE layers within the same parent composition (the same nested
 * precomp used more than once), and every real instance must be reported -
 * never silently narrowed to the first (see findHostLayers's own doc
 * comment). A single-candidate slot (`length === 1`) is the overwhelmingly
 * common case and behaves byte-identically to the pre-2026-09-10 single-hop
 * model; `computeChainVisibleRanges` below is what actually computes the
 * UNION of valid ranges across multiple candidates at one slot.
 */
export type ChainHopSlot = readonly ChainHop[];

/** One mapping's complete real nested-target chain, ordered OUTERMOST slot first, actual leaf slot LAST. */
export interface LabeledChain {
  label: string;
  hopSlots: ChainHopSlot[];
}

/**
 * One INSPECT_SCENE_EVIDENCE dispatch target - mirrors
 * apps/api's derivePreviewTimingTargets exactly (same doc-commented
 * reasoning, same outer-discovery prepend rule) so the two never drift
 * apart on what a given `previewTimingChainIndex` addresses.
 */
export interface PreviewTimingChainTarget {
  compositionId: string;
  layerIndices: number[];
}

/**
 * Client-side mirror of apps/api's derivePreviewTimingTargets - same
 * "walk every hop of every mapping's own real humanNestedTarget chain,
 * deduped by (compositionId, layerIndex)" logic. Returns an EMPTY array
 * when no mapping has a real nested target at all (nothing to analyze
 * generically here).
 *
 * Does NOT resolve how a chain's own first hop is placed inside the
 * scene's real master/render composition - see
 * `distinctChainEntryCompositionIds`/`discoverPathToComposition` below for
 * that (a SEPARATE, adaptive graph search - live QA, 2026-09-10 real
 * incident: a mapping's own chain never records that placement, and it is
 * not always a single direct hop).
 */
export function derivePreviewTimingChainTargets(mappings: readonly PlaceholderMapping[]): PreviewTimingChainTarget[] {
  const layerIndicesByCompositionId = new Map<string, Set<number>>();
  const orderedCompositionIds: string[] = [];

  for (const mapping of mappings) {
    const steps = mapping.humanNestedTarget;
    if (!steps || steps.length === 0) {
      continue;
    }
    for (const step of steps) {
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

/**
 * The distinct compositionIds that are some mapping's own FIRST
 * humanNestedTarget hop, excluding `outerMostCompositionId` itself (which
 * needs no discovery - it's already the scene's own known top-level
 * composition). Each one needs a real graph-discovery search (see
 * `discoverPathToComposition`) to find how it's actually placed inside
 * `outerMostCompositionId`.
 */
export function distinctChainEntryCompositionIds(mappings: readonly PlaceholderMapping[], outerMostCompositionId: string): string[] {
  const seen = new Set<string>();
  for (const mapping of mappings) {
    const steps = mapping.humanNestedTarget;
    if (!steps || steps.length === 0) {
      continue;
    }
    const first = steps[0]!.compositionId;
    if (first !== outerMostCompositionId) {
      seen.add(first);
    }
  }
  return [...seen];
}

/**
 * Fetches the real, targeted host-layer lookup (live QA, 2026-09-10
 * incident, session a7fee3d9) for ONE already manifest-confirmed
 * parent -> child containment edge - the actual dispatch/poll mechanics
 * live in the caller (ProjectPreviewTab), never here, so this module stays
 * free of any network/job-polling concern and is directly unit-testable
 * against a fake in-memory composition graph.
 *
 * This REPLACES the prior "discovery mode scan + optional early-exit
 * target hint" fetcher shape: a real retry proved that even a trimmed,
 * early-exiting full-layer scan still times out on a large parent
 * composition, since per-layer classification/object-construction cost
 * alone (not merely the property reads a caller can opt out of) was the
 * bottleneck. Both `parentCompositionId` and `childCompositionId` are
 * always required now - there is no longer a broad "just scan this
 * composition and tell me everything you found" mode for graph discovery.
 */
export type HostLayerFetcher = (
  parentCompositionId: string,
  childCompositionId: string
) => Promise<{ ok: true; response: SceneEvidenceResponse } | { ok: false; message: string }>;

/** One composition's own identity + real, AE-confirmed parent edges, as already recorded in the project's own manifest (TemplateManifest['compositions'][number], narrowed to only the fields this module needs). */
export interface ManifestCompositionRef {
  compositionId: string;
  parentCompositionIds: readonly string[];
}

export type ManifestPathResult = { ok: true; path: string[] } | { ok: false; reason: string };

/**
 * Preview Timing Analysis composition-graph discovery, FIX 2 (live QA,
 * 2026-09-10): the PRIMARY source for the real path from
 * `rootCompositionId` down to `targetCompositionId` is the project's own
 * manifest - `parentCompositionIds`, already AE-confirmed by the
 * original, already-successful INSPECT_TEMPLATE inspection, entirely
 * independent of (and immune to) the live layer-scan timeout that caused
 * the real 2026-09-10 incident. No live dispatch of any kind - pure data.
 *
 * Builds a parent -> children adjacency by inverting every composition's
 * own `parentCompositionIds`, then walks it breadth-first from the root.
 * Deterministic: children are always visited in a FIXED order (sorted by
 * compositionId), and compositions are explored breadth-first (a FIFO
 * queue) - so if multiple real graph paths to the target exist, the
 * shortest is always found, and ties at the same depth are always broken
 * the same way for the same real project state (this IS the "handle
 * multiple paths deterministically" requirement - there is never a
 * genuinely unresolvable ambiguity given a fixed composition list). Fails
 * clearly (never guesses, never falls back to a live scan) when no real
 * manifest-recorded path connects the two composition ids at all.
 */
export function deriveManifestContainmentPath(
  compositions: readonly ManifestCompositionRef[],
  rootCompositionId: string,
  targetCompositionId: string
): ManifestPathResult {
  if (rootCompositionId === targetCompositionId) {
    return { ok: true, path: [rootCompositionId] };
  }

  const childrenByParent = new Map<string, string[]>();
  for (const composition of compositions) {
    for (const parentId of composition.parentCompositionIds) {
      let children = childrenByParent.get(parentId);
      if (!children) {
        children = [];
        childrenByParent.set(parentId, children);
      }
      children.push(composition.compositionId);
    }
  }
  for (const children of childrenByParent.values()) {
    children.sort();
  }

  const visited = new Set<string>([rootCompositionId]);
  const queue: { compositionId: string; path: string[] }[] = [{ compositionId: rootCompositionId, path: [rootCompositionId] }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenByParent.get(current.compositionId) ?? [];
    for (const child of children) {
      const newPath = [...current.path, child];
      if (child === targetCompositionId) {
        return { ok: true, path: newPath };
      }
      if (!visited.has(child)) {
        visited.add(child);
        queue.push({ compositionId: child, path: newPath });
      }
    }
  }

  return { ok: false, reason: `"${targetCompositionId}" has no real containment path from "${rootCompositionId}" in the current project manifest's own composition graph - refusing to guess.` };
}

export type FindHostLayersResult = { ok: true; matches: HostLayerRecord[] } | { ok: false; reason: string };

/**
 * Converts one real, AE-confirmed `HostLayerRecord` (from the targeted
 * `findHostLayers` lookup below) directly into a `ChainHop` - the host-
 * layer record already carries every piece of evidence a `ChainHop` needs
 * (window, stretch, timeRemapEnabled, opacity), read in the SAME minimal
 * Worker scan that found the layer, so no separate `layers[]`/
 * `layerDetails[]` cross-reference is ever required for a discovered hop
 * (unlike a mapping's own approved `humanNestedTarget` steps, which still
 * come from a distinct INSPECT_SCENE_EVIDENCE dispatch - see
 * `resolvePreviewTimingChains` below).
 */
function hostLayerRecordToChainHop(compositionId: string, record: HostLayerRecord): ChainHop {
  return {
    compositionId,
    window: {
      layerIndex: record.layerIndex,
      enabled: record.enabled,
      inPointSeconds: record.inPointSeconds,
      outPointSeconds: record.outPointSeconds,
      startTimeSeconds: record.startTimeSeconds
    },
    stretchPercent: record.stretchPercent,
    timeRemapEnabled: record.timeRemapEnabled,
    opacity: { staticPercent: record.opacityStatic, keyframes: record.opacityKeyframes }
  };
}

/**
 * Preview Timing Analysis TARGETED HOST-LAYER LOOKUP (live QA, 2026-09-10
 * real incident, session a7fee3d9): finds EVERY real layer inside
 * `parentCompositionId` that hosts `childCompositionId` - the ONE fact the
 * manifest itself cannot supply (it records real containment edges, never
 * AE layer indices/timing). This is the ONLY live evidence this feature's
 * graph-discovery step ever needs, since `deriveManifestContainmentPath`
 * already supplies the full composition SEQUENCE from durable,
 * pre-confirmed manifest data.
 *
 * REPLACES the prior `findLayerHostingComposition` (single-match,
 * full/discovery-mode layerDetails scan): a real retry proved that even a
 * trimmed, early-exiting full-layer scan still times out on a large parent
 * composition (the real incident: "!Render", ~40+ layers) since per-layer
 * classification/object-construction cost alone - not merely the property
 * reads a caller could already opt out of - was the bottleneck. The new
 * Worker-side `buildFindHostLayersScript` does zero classification/
 * construction work for a non-matching layer and never breaks early, so it
 * genuinely reports EVERY real instance of a possibly-duplicated child
 * composition, never silently narrowed to the first (see this module's own
 * `ChainHopSlot`/`computeChainVisibleRanges` for how multiple instances
 * propagate as a union of valid visibility ranges).
 *
 * Three distinct outcomes, never conflated:
 *   1. Scan FAILURE (`hostLayerRecords === null`, e.g. a real Worker/MCP
 *      timeout) - a clear EVIDENCE GAP, never treated as "not found". This
 *      was the exact conflation behind the 2026-09-10 incident's original
 *      false "comp-1 is not reachable from comp-210" conclusion.
 *   2. Scan SUCCEEDED but found zero real matching layers
 *      (`hostLayerRecords: []`) despite the manifest recording this exact
 *      containment edge - reported with the explicit `MANIFEST_EDGE_NOT_FOUND_IN_AE`
 *      marker, a genuine structural discrepancy between the manifest and
 *      live AE state, distinct from an evidence gap.
 *   3. Scan SUCCEEDED and found one or more real matches - returned as-is,
 *      every match, for the caller to propagate through.
 */
export async function findHostLayers(
  parentCompositionId: string,
  childCompositionId: string,
  fetchHostLayersForEdge: HostLayerFetcher
): Promise<FindHostLayersResult> {
  const result = await fetchHostLayersForEdge(parentCompositionId, childCompositionId);
  if (!result.ok) {
    return { ok: false, reason: result.message };
  }
  // SCAN FAILED != EMPTY COMPOSITION - a null hostLayerRecords means the
  // Worker's own scan did not complete (see hostLayerRecordsFailureReason),
  // never that the parent genuinely hosts zero matching layers.
  if (result.response.hostLayerRecords === null) {
    return {
      ok: false,
      reason: `Could not determine which layer in "${parentCompositionId}" hosts "${childCompositionId}" - the Worker's own layer scan did not complete${
        result.response.hostLayerRecordsFailureReason ? `: ${result.response.hostLayerRecordsFailureReason}` : ""
      }. Refusing to treat an incomplete scan as "not found".`
    };
  }
  if (result.response.hostLayerRecords.length === 0) {
    return {
      ok: false,
      reason: `MANIFEST_EDGE_NOT_FOUND_IN_AE: "${childCompositionId}" does not appear as a real nested composition inside "${parentCompositionId}" despite the manifest recording that containment edge - the manifest's own edge could not be confirmed by live AE evidence.`
    };
  }
  return { ok: true, matches: result.response.hostLayerRecords };
}

export type ResolveManifestPathResult = { ok: true; hopSlots: ChainHopSlot[] } | { ok: false; reason: string };

/**
 * Preview Timing Analysis composition-graph discovery, combined manifest
 * path + targeted host-layer lookup (live QA, 2026-09-10 real incident,
 * session a7fee3d9): the PRIMARY, manifest-driven replacement for the old
 * live-BFS `discoverPathToComposition`. Resolves the real composition
 * SEQUENCE from `rootCompositionId` to `targetCompositionId` entirely from
 * the manifest (`deriveManifestContainmentPath` - zero live dispatches),
 * then makes exactly ONE targeted, evidence-failure-aware live lookup per
 * hop (`findHostLayers`) to discover EVERY real host layer for that hop -
 * never a broad, exploratory scan of every sibling composition the way the
 * retired BFS approach did, and never silently narrowed to a single match
 * when the same child composition is placed more than once inside its
 * parent. Live AE evidence is used ONLY for what the manifest cannot
 * supply (the real host layer(s), plus - via the SAME minimal scan - real
 * timing/stretch/opacity properties for each one), never to rediscover
 * graph structure the manifest already provides.
 */
export async function resolveManifestPathHops(
  compositions: readonly ManifestCompositionRef[],
  rootCompositionId: string,
  targetCompositionId: string,
  fetchHostLayersForEdge: HostLayerFetcher
): Promise<ResolveManifestPathResult> {
  const pathResult = deriveManifestContainmentPath(compositions, rootCompositionId, targetCompositionId);
  if (!pathResult.ok) {
    return { ok: false, reason: pathResult.reason };
  }
  const sequence = pathResult.path;
  if (sequence.length <= 1) {
    return { ok: true, hopSlots: [] };
  }

  const hopSlots: ChainHopSlot[] = [];
  for (let i = 0; i < sequence.length - 1; i++) {
    const parentCompositionId = sequence[i]!;
    const childCompositionId = sequence[i + 1]!;
    const found = await findHostLayers(parentCompositionId, childCompositionId, fetchHostLayersForEdge);
    if (!found.ok) {
      return { ok: false, reason: found.reason };
    }
    hopSlots.push(found.matches.map((match) => hostLayerRecordToChainHop(parentCompositionId, match)));
  }
  return { ok: true, hopSlots };
}

function toWindow(evidence: LayerEvidence): LayerWindow {
  return {
    layerIndex: evidence.layerIndex,
    enabled: evidence.enabled,
    inPointSeconds: evidence.inPointSeconds,
    outPointSeconds: evidence.outPointSeconds,
    startTimeSeconds: evidence.startTimeSeconds
  };
}

function toOpacity(detail: LayerDetailFact | undefined): OpacityFact | null {
  if (!detail) {
    return null;
  }
  return { staticPercent: detail.opacityStatic, keyframes: detail.opacityKeyframes };
}

export type ResolveChainsResult = { ok: true; chains: LabeledChain[] } | { ok: false; reason: string };

/**
 * Resolves every mapping's own COMPLETE hop-slot chain (real evidence at
 * every slot) from the real INSPECT_SCENE_EVIDENCE results gathered so
 * far. `resultsByCompositionId` is the union of every KNOWN human-chain
 * target (`derivePreviewTimingChainTargets`) result this analysis run has
 * collected, keyed by the compositionId it was captured against - used
 * only for a mapping's own approved `humanNestedTarget` steps, each always
 * a single fixed layer. A discovered prefix slot (from
 * `discoveredOuterPaths`) never needs this lookup - its own real evidence
 * already travels with it (see `hostLayerRecordToChainHop`).
 *
 * `discoveredOuterPaths` maps a chain's own first-hop compositionId to the
 * REAL hop-slot sequence (root-first, one slot per composition-graph edge,
 * each slot possibly carrying MULTIPLE real candidate host layers - live
 * QA, 2026-09-10 targeted host-layer lookup extension) that reaches it from
 * `outerMostCompositionId` - empty array when that compositionId already
 * equals `outerMostCompositionId` (no discovery needed). A mapping whose
 * first hop has no entry here at all is refused clearly (evidence gap),
 * never silently treated as a direct/identity placement.
 *
 * Fails clearly (never guesses) when a required approved step's own
 * evidence is missing from its own composition's collected result.
 */
export function resolvePreviewTimingChains(
  mappings: readonly PlaceholderMapping[],
  outerMostCompositionId: string,
  discoveredOuterPaths: ReadonlyMap<string, readonly ChainHopSlot[]>,
  resultsByCompositionId: ReadonlyMap<string, SceneEvidenceResponse>
): ResolveChainsResult {
  const byComposition = new Map<string, { layers: Map<number, LayerEvidence>; layerDetails: Map<number, LayerDetailFact> }>();
  for (const [compositionId, result] of resultsByCompositionId) {
    byComposition.set(compositionId, {
      layers: new Map(result.layers.map((l) => [l.layerIndex, l])),
      layerDetails: new Map((result.layerDetails ?? []).map((d) => [d.layerIndex, d]))
    });
  }

  const chains: LabeledChain[] = [];
  for (const mapping of mappings) {
    const steps = mapping.humanNestedTarget;
    if (!steps || steps.length === 0) {
      continue;
    }
    const label = mapping.placeholderName ?? `Mapping ${mapping.id}`;
    const entryCompositionId = steps[0]!.compositionId;

    const hopSlots: ChainHopSlot[] = [];
    if (entryCompositionId !== outerMostCompositionId) {
      const discoveredPath = discoveredOuterPaths.get(entryCompositionId);
      if (!discoveredPath) {
        return {
          ok: false,
          reason: `"${label}" needs to know how "${entryCompositionId}" is placed inside "${outerMostCompositionId}", but that was never discovered - refusing to guess.`
        };
      }
      hopSlots.push(...discoveredPath);
    }

    for (const step of steps) {
      const entry = byComposition.get(step.compositionId);
      const layerEvidence = entry?.layers.get(step.layerIndex);
      if (!layerEvidence) {
        return { ok: false, reason: `Missing real timing evidence for layer ${step.layerIndex} in "${step.compositionId}" (required for "${label}") - refusing to guess.` };
      }
      const detail = entry?.layerDetails.get(step.layerIndex);
      hopSlots.push([
        {
          compositionId: step.compositionId,
          window: toWindow(layerEvidence),
          stretchPercent: detail?.stretchPercent ?? null,
          timeRemapEnabled: detail?.timeRemapEnabled ?? null,
          opacity: toOpacity(detail)
        }
      ]);
    }
    chains.push({ label, hopSlots });
  }

  if (chains.length === 0) {
    return { ok: false, reason: "No mapping has a real nested target chain to analyze." };
  }
  return { ok: true, chains };
}

function clampRangesTo(ranges: Range[], bound: Range): Range[] {
  const [boundStart, boundEnd] = bound;
  const out: Range[] = [];
  for (const [start, end] of ranges) {
    const clampedStart = Math.max(start, boundStart);
    const clampedEnd = Math.min(end, boundEnd);
    if (clampedStart < clampedEnd) {
      out.push([clampedStart, clampedEnd]);
    }
  }
  return out;
}

function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length <= 1) {
    return ranges;
  }
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]!;
    const current = sorted[i]!;
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function intersectRangeLists(a: Range[], b: Range[]): Range[] {
  const out: Range[] = [];
  for (const rangeA of a) {
    for (const rangeB of b) {
      const start = Math.max(rangeA[0], rangeB[0]);
      const end = Math.min(rangeA[1], rangeB[1]);
      if (start < end) {
        out.push([start, end]);
      }
    }
  }
  return mergeRanges(out);
}

/**
 * The real sub-intervals of `[windowStart, windowEnd]` (a layer's own
 * inPoint/outPoint, in its own containing composition's timeline) where
 * that layer's real opacity is greater than 0.
 *
 * `opacity === null` (the property could not be read at all) is treated
 * as fully visible over the whole window - consistent with this whole
 * module's existing philosophy for stretch/timeRemap (never refuse
 * merely because a read failed to null; only refuse on a CONFIRMED
 * value). A confirmed static value is either fully visible (>0) or fully
 * invisible (=== 0) over the whole window.
 *
 * A confirmed ANIMATED value (real keyframes) is evaluated as PIECEWISE
 * LINEAR between consecutive keyframes, holding flat before the first and
 * after the last (AE's own real default keyframe behavior, absent a
 * separate expression/time-remap). This is a documented, deliberate
 * simplification: it does not reproduce AE's exact easing curve (Bezier/
 * ease keyframes bend the curve, they do not change its SIGN, since AE
 * opacity is clamped to 0-100 with no negative overshoot) - so a linear
 * model is safe for determining WHERE a segment is >0 vs ===0, even
 * though the precise sub-second boundary of a non-linear ease could shift
 * slightly. A segment between two keyframes contributes a visible
 * interval unless BOTH its endpoint values are exactly 0 (the only case
 * where the sign is unambiguous regardless of easing).
 */
export function opacityVisibleIntervals(opacity: OpacityFact | null, windowStart: number, windowEnd: number): Range[] {
  if (windowStart >= windowEnd) {
    return [];
  }
  if (opacity === null) {
    return [[windowStart, windowEnd]];
  }
  if (opacity.keyframes === null) {
    if (opacity.staticPercent === null) {
      return [[windowStart, windowEnd]];
    }
    return opacity.staticPercent > 0 ? [[windowStart, windowEnd]] : [];
  }

  const keyframes = [...opacity.keyframes].sort((a, b) => a.timeSeconds - b.timeSeconds);
  if (keyframes.length === 0) {
    return [[windowStart, windowEnd]];
  }

  const segments: Range[] = [];
  const first = keyframes[0]!;
  if (windowStart < first.timeSeconds && first.valuePercent > 0) {
    segments.push([windowStart, Math.min(first.timeSeconds, windowEnd)]);
  }
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i]!;
    const b = keyframes[i + 1]!;
    const segStart = Math.max(a.timeSeconds, windowStart);
    const segEnd = Math.min(b.timeSeconds, windowEnd);
    if (segStart >= segEnd) {
      continue;
    }
    if (!(a.valuePercent === 0 && b.valuePercent === 0)) {
      segments.push([segStart, segEnd]);
    }
  }
  const last = keyframes[keyframes.length - 1]!;
  if (windowEnd > last.timeSeconds && last.valuePercent > 0) {
    segments.push([Math.max(last.timeSeconds, windowStart), windowEnd]);
  }

  return mergeRanges(clampRangesTo(segments, [windowStart, windowEnd]));
}

export type ChainVisibilityResult = { ok: true; ranges: Range[] } | { ok: false; reason: string };

type CandidateRangesResult = { ok: true; ranges: Range[] } | { ok: false; reason: string };

/** The real visible sub-range(s) of one LEAF candidate's own window - identical logic/messages to the pre-2026-09-10 single-hop leaf handling. */
function leafCandidateRanges(leaf: ChainHop): CandidateRangesResult {
  if (!leaf.window.enabled) {
    return { ok: false, reason: `Layer ${leaf.window.layerIndex} in "${leaf.compositionId}" is disabled - never visible, regardless of timestamp.` };
  }
  const ranges = opacityVisibleIntervals(leaf.opacity, leaf.window.inPointSeconds, leaf.window.outPointSeconds);
  if (ranges.length === 0) {
    return { ok: false, reason: `Layer ${leaf.window.layerIndex} in "${leaf.compositionId}" has confirmed opacity 0 throughout its own visible window - never visible.` };
  }
  return { ok: true, ranges };
}

/** Maps `ranges` (already resolved in the nested composition's own local timeline) through one WRAPPER candidate's own stretch/window/opacity - identical logic/messages to the pre-2026-09-10 single-hop wrapper handling. */
function wrapperCandidateRanges(wrapper: ChainHop, ranges: Range[]): CandidateRangesResult {
  if (!wrapper.window.enabled) {
    return { ok: false, reason: `Wrapper layer ${wrapper.window.layerIndex} in "${wrapper.compositionId}" is disabled - nothing nested inside it can ever be visible.` };
  }
  if (wrapper.timeRemapEnabled === true) {
    return {
      ok: false,
      reason: `Wrapper layer ${wrapper.window.layerIndex} in "${wrapper.compositionId}" has time remapping enabled - its nested content's real timing cannot be calculated from linear stretch alone, and no real time-remap keyframe evidence is available. Refusing to guess.`
    };
  }
  const stretchFactor = (wrapper.stretchPercent ?? 100) / 100;
  if (!Number.isFinite(stretchFactor) || stretchFactor <= 0) {
    return { ok: false, reason: `Wrapper layer ${wrapper.window.layerIndex}'s own stretch (${wrapper.stretchPercent}%) in "${wrapper.compositionId}" is not a usable positive value.` };
  }

  let mapped: Range[] = ranges.map(([start, end]) => [
    wrapper.window.startTimeSeconds + start * stretchFactor,
    wrapper.window.startTimeSeconds + end * stretchFactor
  ]);
  mapped = clampRangesTo(mapped, [wrapper.window.inPointSeconds, wrapper.window.outPointSeconds]);
  if (mapped.length === 0) {
    return { ok: false, reason: `Never overlaps wrapper layer ${wrapper.window.layerIndex}'s own visible window in "${wrapper.compositionId}" - it would never be visible at any timestamp.` };
  }

  const wrapperOpacityRanges = opacityVisibleIntervals(wrapper.opacity, wrapper.window.inPointSeconds, wrapper.window.outPointSeconds);
  mapped = intersectRangeLists(mapped, wrapperOpacityRanges);
  if (mapped.length === 0) {
    return { ok: false, reason: `Wrapper layer ${wrapper.window.layerIndex}'s own opacity is confirmed 0 throughout its own visible window in "${wrapper.compositionId}" - never visible.` };
  }

  return { ok: true, ranges: mapped };
}

/**
 * Multiple-instances union (live QA, 2026-09-10 targeted host-layer lookup
 * extension): evaluates `computeForCandidate` against EVERY candidate hop
 * in `slot`, and returns the UNION (merged) of every candidate that
 * produces a valid range - only refusing when EVERY candidate at this slot
 * fails. For the overwhelmingly common single-candidate slot, this is
 * byte-identical to calling `computeForCandidate` directly: one success
 * merges to itself, one failure returns that exact same failure reason
 * (never wrapped/rephrased).
 */
function unionOverSlot(slot: ChainHopSlot, computeForCandidate: (candidate: ChainHop) => CandidateRangesResult): CandidateRangesResult {
  const successRanges: Range[][] = [];
  const failureReasons: string[] = [];
  for (const candidate of slot) {
    const result = computeForCandidate(candidate);
    if (result.ok) {
      successRanges.push(result.ranges);
    } else {
      failureReasons.push(result.reason);
    }
  }
  if (successRanges.length === 0) {
    return {
      ok: false,
      reason: slot.length === 1 ? failureReasons[0]! : `None of the ${slot.length} candidate host layers produced a valid visible range: ${failureReasons.join(" | ")}`
    };
  }
  return { ok: true, ranges: mergeRanges(successRanges.flat()) };
}

/**
 * Composes the real AE nested-composition time-mapping formula (this
 * module's own doc comment above) through EVERY hop-slot of a chain, from
 * the actual leaf slot outward to the chain's own outermost slot -
 * arbitrary depth, never bounded to a fixed number of hops. Real,
 * confirmed opacity (static or animated) is intersected in at every hop,
 * not merely collected.
 *
 * Live QA, 2026-09-10 targeted host-layer lookup extension: a slot may
 * carry MULTIPLE real candidate host layers (the same child composition
 * placed more than once inside the same parent) - the visible range at
 * that slot is the UNION of every candidate's own valid range, never a
 * single arbitrarily-chosen instance (see `unionOverSlot`). For the
 * overwhelmingly common single-candidate-per-slot case, this produces
 * byte-identical results to the pre-2026-09-10 single-hop model.
 */
export function computeChainVisibleRanges(hopSlots: readonly ChainHopSlot[]): ChainVisibilityResult {
  if (hopSlots.length === 0) {
    return { ok: false, reason: "Empty chain - no hops to calculate visibility for." };
  }

  const leafSlot = hopSlots[hopSlots.length - 1]!;
  const leafOutcome = unionOverSlot(leafSlot, leafCandidateRanges);
  if (!leafOutcome.ok) {
    return leafOutcome;
  }
  let ranges = leafOutcome.ranges;

  for (let i = hopSlots.length - 2; i >= 0; i--) {
    const slot = hopSlots[i]!;
    const outcome = unionOverSlot(slot, (candidate) => wrapperCandidateRanges(candidate, ranges));
    if (!outcome.ok) {
      return outcome;
    }
    ranges = outcome.ranges;
  }

  return { ok: true, ranges: mergeRanges(ranges) };
}

export type PreviewTimingCalculationResult =
  | {
      ok: true;
      /** Every label's own real, fully-composed visible range(s) on the outermost (master) timeline - possibly more than one, when opacity animation creates gaps. */
      rangesByLabel: Record<string, Range[]>;
      /** The real intersection of every label's own ranges - empty when no single timestamp shows all of them at once (see `usedOverlap`). */
      overlapRanges: Range[];
      /** The midpoint of the chosen range - see this function's own doc comment for exactly which range is chosen and why. */
      recommendedTimestampSeconds: number;
      usedOverlap: boolean;
    }
  | { ok: false; reason: string };

/**
 * Deterministic representative-timestamp rule (documented, never a
 * guess):
 *   - If every label's own ranges share at least one overlapping
 *     interval, recommend the midpoint of the LARGEST such overlap
 *     (by duration; ties broken by the earliest start) - the widest
 *     shared window is the most robust single frame to represent every
 *     label at once.
 *   - If they never overlap, recommend the midpoint of the single
 *     LARGEST range across every label's own ranges (same tie-break) -
 *     still real, measured evidence, never an average or a guess; report
 *     `usedOverlap: false` so a caller can warn that not everything is
 *     simultaneously visible at the chosen timestamp.
 */
export function calculatePreviewTiming(chains: readonly LabeledChain[]): PreviewTimingCalculationResult {
  if (chains.length === 0) {
    return { ok: false, reason: "No chains provided to calculate visibility for." };
  }

  const rangesByLabel: Record<string, Range[]> = {};
  for (const chain of chains) {
    const result = computeChainVisibleRanges(chain.hopSlots);
    if (!result.ok) {
      return { ok: false, reason: `"${chain.label}": ${result.reason}` };
    }
    rangesByLabel[chain.label] = result.ranges;
  }

  const labels = Object.keys(rangesByLabel);
  let overlapRanges: Range[] = rangesByLabel[labels[0]!]!;
  for (let i = 1; i < labels.length; i++) {
    overlapRanges = intersectRangeLists(overlapRanges, rangesByLabel[labels[i]!]!);
  }

  const largestRange = (ranges: Range[]): Range => ranges.reduce((best, r) => (r[1] - r[0] > best[1] - best[0] ? r : best));

  const usedOverlap = overlapRanges.length > 0;
  const chosenRange = usedOverlap ? largestRange(overlapRanges) : largestRange(labels.flatMap((label) => rangesByLabel[label]!));
  const recommendedTimestampSeconds = (chosenRange[0] + chosenRange[1]) / 2;

  return { ok: true, rangesByLabel, overlapRanges: usedOverlap ? overlapRanges : [], recommendedTimestampSeconds, usedOverlap };
}
