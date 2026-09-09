/**
 * Preview Timing Analysis (live QA, 2026-09-09 real incident): calculates
 * exactly when nested branding content becomes visible on the OUTER
 * (assumed !Render-absolute) composition's own timeline, from real,
 * worker-captured layer evidence - never a guess, never an average scene
 * duration.
 *
 * Real AE nested-composition time mapping (the one this implements):
 * for a layer L living inside composition C, L's own inPoint/outPoint/
 * startTime are all expressed in C's own timeline. If C itself is placed
 * as a layer P inside an OUTER composition, C's own local time 0
 * corresponds to the outer composition's time = P.startTime, and C's
 * local time T corresponds to outer time = P.startTime + T * (P.stretch / 100).
 * A leaf layer nested inside C is therefore visible in the OUTER
 * composition's timeline during the intersection of that mapped window
 * with P's own visible window there ([P.inPoint, P.outPoint]) - nothing
 * nested inside P can ever be visible outside P's own presence.
 *
 * Deliberately refuses (never silently proceeds with a wrong number)
 * when:
 *   - the wrapper layer's own time remapping is enabled - real time-remap
 *     keyframes are non-linear and this worker has no keyframe evidence,
 *     only whether remapping is on at all (see jsx-templates.ts's own
 *     doc comment on why that's all the real, allowlisted ae_run_jsx
 *     channel can honestly report).
 *   - the wrapper layer, or any leaf, is disabled.
 *   - a leaf's own mapped window never actually overlaps the wrapper's
 *     visible window (it could never be visible at any timestamp).
 */

import type { PlaceholderMapping } from "@dyo/schemas";

export interface NestedTargetHops {
  wrapperCompositionId: string;
  wrapperLayerIndex: number;
  innerCompositionId: string;
  /** One entry per distinct mapping reaching this inner composition - `label` is the mapping's own real placeholderName, never invented. */
  leaves: { label: string; layerIndex: number }[];
}

/**
 * Client-side mirror of apps/api's derivePreviewTimingTargets (same
 * two-hop scope, same doc-commented reasoning for stopping there) - this
 * one additionally keeps each leaf's own real placeholderName as a
 * human-readable label (never invented), since the web UI needs to show
 * "Logo"/"Hebrew branding" rather than bare layer indices in Simple Mode.
 * Only ever supports exactly ONE shared wrapper (one shared first hop) -
 * returns null if the scene's mappings don't share one (nothing to
 * analyze generically here), or if fewer than one mapping has a real
 * two-hop nested target at all.
 */
export function deriveNestedTargetHops(mappings: readonly PlaceholderMapping[]): NestedTargetHops | null {
  let wrapperCompositionId: string | null = null;
  let wrapperLayerIndex: number | null = null;
  let innerCompositionId: string | null = null;
  const leaves: { label: string; layerIndex: number }[] = [];

  for (const mapping of mappings) {
    const hops = mapping.humanNestedTarget;
    if (!hops || hops.length < 2) {
      continue;
    }
    const [hop0, hop1] = hops;
    if (wrapperCompositionId === null) {
      wrapperCompositionId = hop0!.compositionId;
      wrapperLayerIndex = hop0!.layerIndex;
      innerCompositionId = hop1!.compositionId;
    } else if (hop0!.compositionId !== wrapperCompositionId || hop0!.layerIndex !== wrapperLayerIndex || hop1!.compositionId !== innerCompositionId) {
      // A mapping with a genuinely different first or second hop - this
      // simple analysis only supports one shared wrapper/inner pair.
      continue;
    }
    leaves.push({ label: mapping.placeholderName ?? `Mapping ${mapping.id}`, layerIndex: hop1!.layerIndex });
  }

  if (wrapperCompositionId === null || innerCompositionId === null || wrapperLayerIndex === null || leaves.length === 0) {
    return null;
  }
  return { wrapperCompositionId, wrapperLayerIndex, innerCompositionId, leaves };
}

export interface LayerWindow {
  layerIndex: number;
  enabled: boolean;
  inPointSeconds: number;
  outPointSeconds: number;
  startTimeSeconds: number;
}

export interface LabeledLeafLayer {
  label: string;
  window: LayerWindow;
}

export interface PreviewTimingCalculationInput {
  /** The layer that hosts the nested composition (e.g. comp-1's own layer 3, which places Pre-comp 3) - its own timing is expressed in the OUTER composition's timeline, assumed to be !Render-absolute time. */
  outerLayer: LayerWindow;
  /** Real `layer.stretch` for the wrapper layer, from layerDetails - null only if it could not be read (see jsx-templates.ts). Defaults to 100 (AE's own default, unstretched) only when genuinely null, never when it was actually read as some other real value. */
  outerLayerStretchPercent: number | null;
  /** Real `layer.timeRemapEnabled` for the wrapper layer. true refuses the calculation outright (see module doc comment). */
  outerLayerTimeRemapEnabled: boolean | null;
  /** One or more leaf layers living INSIDE the nested composition the wrapper hosts - each one's own inPoint/outPoint/startTime are in that inner composition's own local timeline. */
  leafLayers: LabeledLeafLayer[];
}

export type PreviewTimingCalculationResult =
  | {
      ok: true;
      /** The wrapper-relative-outer-composition visible range for each leaf, keyed by its own label. */
      rangesByLabel: Record<string, [number, number]>;
      /** The intersection of every leaf's own range - null when no single timestamp shows all of them at once. */
      overlapRange: [number, number] | null;
      /** The midpoint of overlapRange if one exists; otherwise the midpoint of the first leaf's own range (still real evidence, never a guess) - see `usedOverlap` to tell which. */
      recommendedTimestampSeconds: number;
      usedOverlap: boolean;
    }
  | { ok: false; reason: string };

export function calculateBrandingVisibility(input: PreviewTimingCalculationInput): PreviewTimingCalculationResult {
  const { outerLayer, outerLayerStretchPercent, outerLayerTimeRemapEnabled, leafLayers } = input;

  if (!outerLayer.enabled) {
    return { ok: false, reason: `The wrapper layer (index ${outerLayer.layerIndex}) is disabled - nothing nested inside it can ever be visible, regardless of timestamp.` };
  }
  if (outerLayerTimeRemapEnabled === true) {
    return {
      ok: false,
      reason: `The wrapper layer (index ${outerLayer.layerIndex}) has time remapping enabled - its nested content's real timing cannot be calculated from linear stretch alone, and no real time-remap keyframe evidence is available. Refusing to guess.`
    };
  }
  if (leafLayers.length === 0) {
    return { ok: false, reason: "No leaf layers were provided to calculate visibility for." };
  }

  const stretchFactor = (outerLayerStretchPercent ?? 100) / 100;
  if (!Number.isFinite(stretchFactor) || stretchFactor <= 0) {
    return { ok: false, reason: `The wrapper layer's own stretch (${outerLayerStretchPercent}%) is not a usable positive value.` };
  }

  const rangesByLabel: Record<string, [number, number]> = {};
  for (const leaf of leafLayers) {
    if (!leaf.window.enabled) {
      return { ok: false, reason: `"${leaf.label}" (layer index ${leaf.window.layerIndex}) is disabled - it is never visible, regardless of timestamp.` };
    }
    // Map the leaf's own LOCAL (inner-composition) in/out points into the
    // OUTER composition's absolute time.
    const absoluteStart = outerLayer.startTimeSeconds + leaf.window.inPointSeconds * stretchFactor;
    const absoluteEnd = outerLayer.startTimeSeconds + leaf.window.outPointSeconds * stretchFactor;
    // Bounded by the wrapper layer's own visible window - nothing nested
    // inside it can be visible outside that.
    const clampedStart = Math.max(absoluteStart, outerLayer.inPointSeconds);
    const clampedEnd = Math.min(absoluteEnd, outerLayer.outPointSeconds);
    if (clampedStart >= clampedEnd) {
      return {
        ok: false,
        reason: `"${leaf.label}" (layer index ${leaf.window.layerIndex}) never overlaps the wrapper layer's own visible window - it would never be visible at any timestamp.`
      };
    }
    rangesByLabel[leaf.label] = [clampedStart, clampedEnd];
  }

  const ranges = Object.values(rangesByLabel);
  const overlapStart = Math.max(...ranges.map((r) => r[0]));
  const overlapEnd = Math.min(...ranges.map((r) => r[1]));
  const overlapRange: [number, number] | null = overlapStart < overlapEnd ? [overlapStart, overlapEnd] : null;

  const usedOverlap = overlapRange !== null;
  const chosenRange = overlapRange ?? ranges[0]!;
  const recommendedTimestampSeconds = (chosenRange[0] + chosenRange[1]) / 2;

  return { ok: true, rangesByLabel, overlapRange, recommendedTimestampSeconds, usedOverlap };
}
