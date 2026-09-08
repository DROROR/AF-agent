import type { NestedTargetStep, TemplateManifest } from "@dyo/schemas";

/**
 * Verifies a nested AE target path against real manifest evidence only
 * (live QA brand-rule blocker fix, 2026-09-08 correction) - never a name
 * guess. Each step's compositionId must be a real composition in the
 * CURRENT manifest, and must be a real child (compositions[].
 * parentCompositionIds) of the previous step's compositionId, or of
 * `ownerCompositionId` (the mapping's own owning scene) for the first
 * step. Returns a reason string on the first broken link found (fails
 * closed on the whole path rather than accepting a partially-real one).
 *
 * Shared by apply-execution-plan-edit.ts (ADD_MAPPING, at edit time) and
 * resolve-execute-frame-dispatch.ts (at EXECUTE_FRAME dispatch time, live
 * QA execution-wiring fix) - the SAME evidence-based check, never
 * duplicated/reimplemented, so the two can never silently disagree about
 * what counts as a real nested path.
 */
export function verifyNestedTargetPath(manifest: TemplateManifest, ownerCompositionId: string, steps: readonly NestedTargetStep[]): string | null {
  const compositionById = new Map(manifest.compositions.map((c) => [c.compositionId, c]));
  let expectedParentId = ownerCompositionId;
  for (const [index, step] of steps.entries()) {
    const composition = compositionById.get(step.compositionId);
    if (!composition) {
      return `humanNestedTarget step ${index} references compositionId "${step.compositionId}" which does not exist in the current manifest`;
    }
    if (!composition.parentCompositionIds.includes(expectedParentId)) {
      return `humanNestedTarget step ${index}'s compositionId "${step.compositionId}" is not a real child of "${expectedParentId}" (manifest compositions[].parentCompositionIds evidence) - cannot be part of a deterministic nested path from there`;
    }
    expectedParentId = step.compositionId;
  }
  return null;
}
