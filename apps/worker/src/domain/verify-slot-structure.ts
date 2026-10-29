import { computeSlotMutationFingerprint, slotFingerprintsMatch, type SlotChainHop, type SlotFingerprint } from "@dyo/schemas";
import type { ResolvedNestedTargetStep } from "@dyo/schemas";

export type LiveChainStructure =
  | {
      ok: true;
      hops: SlotChainHop[];
      targetWidthPx: number | null;
      targetHeightPx: number | null;
      /** The composition the target layer sits in. Absent from an older worker script. */
      targetCompositionWidthPx?: number | null;
      targetCompositionHeightPx?: number | null;
    }
  | { ok: false; reason: string };

/**
 * STAGE 4: the live structural re-check, immediately before a slot is
 * mutated. Reads the chain, recomputes the approved fingerprint, and refuses
 * when the structure has changed since approval.
 *
 * Two sizes are tried for the target. The slot's own source size is what the
 * manifest records since 2026-10-29. A manifest inspected before that
 * recorded a SOLID placeholder without a size, so its fingerprint carries the
 * size of the composition the solid sits in (real QA template: a 1242×2688
 * solid in a 1242×2648 composition refused every MAP_FOOTAGE as "changed").
 * The chain is compared hop by hop either way; only the size is read the way
 * that manifest read it.
 */
export function verifyLiveSlotStructure(
  live: LiveChainStructure,
  nestedTarget: readonly ResolvedNestedTargetStep[],
  expected: SlotFingerprint
): { ok: true } | { ok: false; reason: string } {
  if (!live.ok) {
    return { ok: false, reason: `the slot's live structure could not be read, so it could not be proven unchanged since approval (${live.reason})` };
  }
  const targetLayerIndex = nestedTarget[nestedTarget.length - 1]?.layerIndex ?? 0;
  const recomputed = computeSlotMutationFingerprint({ chain: live.hops, targetLayerIndex, targetWidthPx: live.targetWidthPx, targetHeightPx: live.targetHeightPx });
  if (slotFingerprintsMatch(recomputed, expected)) {
    return { ok: true };
  }
  const legacy = computeSlotMutationFingerprint({
    chain: live.hops,
    targetLayerIndex,
    targetWidthPx: live.targetCompositionWidthPx ?? null,
    targetHeightPx: live.targetCompositionHeightPx ?? null
  });
  if (slotFingerprintsMatch(legacy, expected)) {
    return { ok: true };
  }
  return {
    ok: false,
    // The live facts are stated, not only their digest (2026-10-04): a
    // refusal that says "changed" without saying WHAT changed could only be
    // diagnosed by installing a new build to ask.
    reason:
      `this slot's structure has changed since the plan was approved (approved ${expected.digest.slice(0, 12)}, now ${recomputed.digest.slice(0, 12)}) - refusing to edit a layer that is no longer the one that was reviewed; re-run template inspection and re-approve. ` +
      `Live chain now: ${JSON.stringify({ hops: live.hops, targetWidthPx: live.targetWidthPx, targetHeightPx: live.targetHeightPx }).slice(0, 1500)}`
  };
}
