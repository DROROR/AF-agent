export interface ReorderableScene {
  scenePlanId: string;
  sourcePosition: number;
  finalOrder: number | null;
  use: boolean;
}

export interface FinalOrderAssignment {
  scenePlanId: string;
  finalOrder: number;
}

/**
 * Pure final-order swap logic for the Scene Mapping table's move-up/down
 * controls. Reorders only among currently-included (`use: true`) scenes -
 * an excluded scene's finalOrder is inert (see Phase 6's
 * apply-execution-plan-edit.ts) and never participates in this ordering.
 * A scene with no finalOrder yet is treated as sitting at its
 * sourcePosition for ordering purposes only - moving it assigns it a real
 * finalOrder for the first time, independent of sourcePosition from then
 * on. Returns null when the move is not possible (already first/last, or
 * the target scene isn't found/isn't included).
 */
export function computeFinalOrderSwap(
  scenes: ReorderableScene[],
  targetScenePlanId: string,
  direction: "up" | "down"
): [FinalOrderAssignment, FinalOrderAssignment] | null {
  const included = scenes
    .filter((scene) => scene.use)
    .map((scene) => ({ ...scene, effective: scene.finalOrder ?? scene.sourcePosition }))
    .sort((a, b) => a.effective - b.effective || a.sourcePosition - b.sourcePosition);

  const index = included.findIndex((scene) => scene.scenePlanId === targetScenePlanId);
  if (index === -1) {
    return null;
  }
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= included.length) {
    return null;
  }

  const target = included[index]!;
  const neighbor = included[swapIndex]!;
  return [
    { scenePlanId: target.scenePlanId, finalOrder: neighbor.effective },
    { scenePlanId: neighbor.scenePlanId, finalOrder: target.effective }
  ];
}
