import { describe, expect, it } from "vitest";
import type { SceneEditResult } from "@dyo/schemas";
import { isSceneEditResultAcceptable } from "../is-scene-edit-result-acceptable.js";

function result(overrides: Partial<SceneEditResult> = {}): SceneEditResult {
  return {
    scenePlanId: "scene-1",
    sourceProjectSha256: "a".repeat(64),
    workingProjectPath: "/checkpoints/job-1/working-copy.aep",
    workingProjectSha256: "b".repeat(64),
    operationsRequested: 1,
    operationsCompleted: [0],
    checkpoint: { completedOperationIndices: [0], checkpointBeforeAt: null, checkpointAfterAt: null, failureReason: null },
    previewFramePath: "/checkpoints/job-1/preview.png",
    previewTimestampSeconds: 2.5,
    failureReason: null,
    startedAt: "2026-08-26T00:00:00.000Z",
    completedAt: "2026-08-26T00:00:01.000Z",
    ...overrides
  };
}

describe("isSceneEditResultAcceptable", () => {
  it("accepts a complete result with a real preview", () => {
    expect(isSceneEditResultAcceptable(result())).toBe(true);
  });

  it("rejects metadata-only success - no preview frame path is never acceptable", () => {
    expect(isSceneEditResultAcceptable(result({ previewFramePath: null }))).toBe(false);
  });

  it("rejects when no preview timestamp is recorded", () => {
    expect(isSceneEditResultAcceptable(result({ previewTimestampSeconds: null }))).toBe(false);
  });

  it("rejects when a failureReason is present, even with a preview", () => {
    expect(isSceneEditResultAcceptable(result({ failureReason: "AE modal suspected" }))).toBe(false);
  });

  it("rejects when not all requested operations completed", () => {
    expect(isSceneEditResultAcceptable(result({ operationsRequested: 2, operationsCompleted: [0] }))).toBe(false);
  });
});
