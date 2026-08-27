import type { SceneEditCheckpoint } from "@dyo/schemas";

/**
 * Worker-side mirror of apps/api/src/domain/execute-scene-edit/scene-edit-checkpoint.ts's
 * exact algorithm - duplicated rather than imported because apps/api and
 * apps/worker are separate applications with no cross-app import path in
 * this monorepo (only packages/* is shared). Keep both copies in sync if
 * this algorithm ever changes; a future pass could extract a genuinely
 * shared package if that drift risk becomes real. See that file for the
 * original tests this mirrors.
 */
export function nextPendingOperationIndex(checkpoint: SceneEditCheckpoint | null, operationCount: number): number | null {
  const completed = new Set(checkpoint?.completedOperationIndices ?? []);
  for (let i = 0; i < operationCount; i++) {
    if (!completed.has(i)) {
      return i;
    }
  }
  return null;
}

export const EMPTY_SCENE_EDIT_CHECKPOINT: SceneEditCheckpoint = {
  completedOperationIndices: [],
  checkpointBeforeAt: null,
  checkpointAfterAt: null,
  failureReason: null
};

export function markOperationCompleted(checkpoint: SceneEditCheckpoint | null, operationIndex: number, now: Date): SceneEditCheckpoint {
  const existing = checkpoint ?? EMPTY_SCENE_EDIT_CHECKPOINT;
  const completed = new Set(existing.completedOperationIndices);
  completed.add(operationIndex);
  return {
    ...existing,
    completedOperationIndices: [...completed].sort((a, b) => a - b),
    checkpointAfterAt: now.toISOString(),
    failureReason: null
  };
}

export function markFailed(checkpoint: SceneEditCheckpoint | null, reason: string, now: Date): SceneEditCheckpoint {
  const existing = checkpoint ?? EMPTY_SCENE_EDIT_CHECKPOINT;
  return { ...existing, checkpointAfterAt: now.toISOString(), failureReason: reason };
}
