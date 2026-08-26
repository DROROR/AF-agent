import { describe, expect, it } from "vitest";
import { computeFinalOrderSwap, type ReorderableScene } from "./scene-reorder";

function scene(overrides: Partial<ReorderableScene> = {}): ReorderableScene {
  return { scenePlanId: "scene-1", sourcePosition: 0, finalOrder: null, use: true, ...overrides };
}

describe("computeFinalOrderSwap", () => {
  it("swaps two adjacent scenes using their source position when neither has an explicit finalOrder yet", () => {
    const scenes = [scene({ scenePlanId: "a", sourcePosition: 0 }), scene({ scenePlanId: "b", sourcePosition: 1 })];
    const result = computeFinalOrderSwap(scenes, "b", "up");
    expect(result).toEqual([
      { scenePlanId: "b", finalOrder: 0 },
      { scenePlanId: "a", finalOrder: 1 }
    ]);
  });

  it("moves a scene down, swapping with its successor", () => {
    const scenes = [scene({ scenePlanId: "a", sourcePosition: 0 }), scene({ scenePlanId: "b", sourcePosition: 1 })];
    const result = computeFinalOrderSwap(scenes, "a", "down");
    expect(result).toEqual([
      { scenePlanId: "a", finalOrder: 1 },
      { scenePlanId: "b", finalOrder: 0 }
    ]);
  });

  it("returns null when moving the first scene up (nothing above it)", () => {
    const scenes = [scene({ scenePlanId: "a", sourcePosition: 0 }), scene({ scenePlanId: "b", sourcePosition: 1 })];
    expect(computeFinalOrderSwap(scenes, "a", "up")).toBeNull();
  });

  it("returns null when moving the last scene down (nothing below it)", () => {
    const scenes = [scene({ scenePlanId: "a", sourcePosition: 0 }), scene({ scenePlanId: "b", sourcePosition: 1 })];
    expect(computeFinalOrderSwap(scenes, "b", "down")).toBeNull();
  });

  it("never reorders against an excluded scene - source position never changes, and excluded scenes are skipped entirely", () => {
    const scenes = [
      scene({ scenePlanId: "a", sourcePosition: 0 }),
      scene({ scenePlanId: "b", sourcePosition: 1, use: false }),
      scene({ scenePlanId: "c", sourcePosition: 2 })
    ];
    const result = computeFinalOrderSwap(scenes, "c", "up");
    expect(result).toEqual([
      { scenePlanId: "c", finalOrder: 0 },
      { scenePlanId: "a", finalOrder: 2 }
    ]);
  });

  it("returns null for an excluded (not currently in-use) target scene", () => {
    const scenes = [scene({ scenePlanId: "a", sourcePosition: 0, use: false }), scene({ scenePlanId: "b", sourcePosition: 1 })];
    expect(computeFinalOrderSwap(scenes, "a", "down")).toBeNull();
  });

  it("respects an existing explicit finalOrder over sourcePosition when computing effective order", () => {
    const scenes = [
      scene({ scenePlanId: "a", sourcePosition: 0, finalOrder: 5 }),
      scene({ scenePlanId: "b", sourcePosition: 1, finalOrder: 1 })
    ];
    // b's effective order (1) is lower than a's (5), so b is actually first.
    expect(computeFinalOrderSwap(scenes, "b", "up")).toBeNull();
    const result = computeFinalOrderSwap(scenes, "a", "up");
    expect(result).toEqual([
      { scenePlanId: "a", finalOrder: 1 },
      { scenePlanId: "b", finalOrder: 5 }
    ]);
  });
});
