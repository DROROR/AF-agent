import { describe, expect, it } from "vitest";
import { markFailed, markOperationCompleted, nextPendingOperationIndex } from "../scene-edit-checkpoint.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");

describe("nextPendingOperationIndex", () => {
  it("returns 0 for a fresh (null) checkpoint", () => {
    expect(nextPendingOperationIndex(null, 3)).toBe(0);
  });

  it("returns the first index not yet marked completed - never blindly restarts from 0 after partial progress", () => {
    const checkpoint = { completedOperationIndices: [0, 1], checkpointBeforeAt: null, checkpointAfterAt: null, failureReason: null };
    expect(nextPendingOperationIndex(checkpoint, 3)).toBe(2);
  });

  it("returns null once every operation has completed", () => {
    const checkpoint = { completedOperationIndices: [0, 1, 2], checkpointBeforeAt: null, checkpointAfterAt: null, failureReason: null };
    expect(nextPendingOperationIndex(checkpoint, 3)).toBeNull();
  });

  it("handles out-of-order completed indices correctly", () => {
    const checkpoint = { completedOperationIndices: [2, 0], checkpointBeforeAt: null, checkpointAfterAt: null, failureReason: null };
    expect(nextPendingOperationIndex(checkpoint, 3)).toBe(1);
  });
});

describe("markOperationCompleted", () => {
  it("adds the operation index and stamps checkpointAfterAt", () => {
    const result = markOperationCompleted(null, 0, NOW);
    expect(result.completedOperationIndices).toEqual([0]);
    expect(result.checkpointAfterAt).toBe(NOW.toISOString());
  });

  it("is idempotent - marking the same index twice never duplicates it", () => {
    const first = markOperationCompleted(null, 0, NOW);
    const second = markOperationCompleted(first, 0, NOW);
    expect(second.completedOperationIndices).toEqual([0]);
  });

  it("preserves prior completed indices across calls (interrupted-job resumability)", () => {
    const afterOp0 = markOperationCompleted(null, 0, NOW);
    const afterOp1 = markOperationCompleted(afterOp0, 1, NOW);
    expect(afterOp1.completedOperationIndices).toEqual([0, 1]);
  });

  it("clears any prior failureReason - a completed operation proves forward progress", () => {
    const failed = markFailed(null, "MCP timeout", NOW);
    const recovered = markOperationCompleted(failed, 0, NOW);
    expect(recovered.failureReason).toBeNull();
  });
});

describe("markFailed", () => {
  it("records the failure reason without discarding already-completed operations", () => {
    const afterOp0 = markOperationCompleted(null, 0, NOW);
    const failed = markFailed(afterOp0, "AE modal suspected", NOW);
    expect(failed.completedOperationIndices).toEqual([0]);
    expect(failed.failureReason).toBe("AE modal suspected");
  });
});
