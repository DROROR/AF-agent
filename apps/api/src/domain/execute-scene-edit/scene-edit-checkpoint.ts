import type { SceneEditCheckpoint } from "@dyo/schemas";

/**
 * Resumability - an interrupted job must never blindly restart from
 * operation 0 if some operations already succeeded (Phase 7A section 6).
 * Returns the index of the first NOT-YET-completed operation, or null if
 * every requested operation already completed.
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

const EMPTY_CHECKPOINT: SceneEditCheckpoint = {
  completedOperationIndices: [],
  checkpointBeforeAt: null,
  checkpointAfterAt: null,
  failureReason: null
};

/** Records one more operation index as completed - idempotent (marking the same index twice never duplicates it), and always clears any prior failureReason since this call proves forward progress. */
export function markOperationCompleted(checkpoint: SceneEditCheckpoint | null, operationIndex: number, now: Date): SceneEditCheckpoint {
  const existing = checkpoint ?? EMPTY_CHECKPOINT;
  const completed = new Set(existing.completedOperationIndices);
  completed.add(operationIndex);
  return {
    ...existing,
    completedOperationIndices: [...completed].sort((a, b) => a - b),
    checkpointAfterAt: now.toISOString(),
    failureReason: null
  };
}

/** Records a failure without discarding whatever operations already genuinely completed - a retry still resumes from the right place, it never loses completed progress. */
export function markFailed(checkpoint: SceneEditCheckpoint | null, reason: string, now: Date): SceneEditCheckpoint {
  const existing = checkpoint ?? EMPTY_CHECKPOINT;
  return { ...existing, checkpointAfterAt: now.toISOString(), failureReason: reason };
}
