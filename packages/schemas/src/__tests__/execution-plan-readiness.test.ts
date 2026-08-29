import { describe, expect, it } from "vitest";
import { getExecutionPlanReadiness } from "../execution-plan-readiness.js";
import type { ScenePlanEntry } from "../execution-plan.js";

function scene(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene A",
    use: true,
    sourcePosition: 0,
    finalOrder: 0,
    finalDuration: null,
    approvalState: "UNREVIEWED",
    instructions: null,
    notes: null,
    unresolvedReasons: [],
    evidence: [],
    mappings: [],
    reelsLayout: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("getExecutionPlanReadiness", () => {
  it("is ready when no used scene has an unresolved reason", () => {
    const result = getExecutionPlanReadiness([scene({ unresolvedReasons: [] })]);
    expect(result).toEqual({ ready: true, unresolvedSceneCount: 0, unresolvedScenePlanIds: [] });
  });

  it("is not ready when a used scene has an unresolved reason", () => {
    const result = getExecutionPlanReadiness([scene({ id: "s1", unresolvedReasons: ["no confident structural classification"] })]);
    expect(result).toEqual({ ready: false, unresolvedSceneCount: 1, unresolvedScenePlanIds: ["s1"] });
  });

  it("never counts an excluded (use: false) scene's unresolved reason against readiness", () => {
    const result = getExecutionPlanReadiness([
      scene({ id: "s1", use: false, unresolvedReasons: ["no confident structural classification"] })
    ]);
    expect(result).toEqual({ ready: true, unresolvedSceneCount: 0, unresolvedScenePlanIds: [] });
  });

  it("reports every unresolved used scene, not just the first", () => {
    const result = getExecutionPlanReadiness([
      scene({ id: "s1", unresolvedReasons: ["x"] }),
      scene({ id: "s2", unresolvedReasons: [] }),
      scene({ id: "s3", unresolvedReasons: ["y"] })
    ]);
    expect(result.ready).toBe(false);
    expect(result.unresolvedSceneCount).toBe(2);
    expect(result.unresolvedScenePlanIds).toEqual(["s1", "s3"]);
  });

  it("is ready for an empty plan (no scenes at all)", () => {
    expect(getExecutionPlanReadiness([])).toEqual({ ready: true, unresolvedSceneCount: 0, unresolvedScenePlanIds: [] });
  });
});
