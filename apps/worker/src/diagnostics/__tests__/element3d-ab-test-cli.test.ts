import { describe, expect, it } from "vitest";
import { computeDiagnosticFrameRange } from "../element3d-ab-test-cli.js";

describe("computeDiagnosticFrameRange", () => {
  it("computes the frame range for comp-1600's local 2.4s-2.8s window at 29.97fps", () => {
    const result = computeDiagnosticFrameRange(7.007007, 29.97, 2.4, 2.8);
    expect(result.startFrame).toBe(Math.round(2.4 * 29.97));
    expect(result.endFrame).toBe(Math.round(2.8 * 29.97));
    expect(result.startFrame).toBeLessThan(result.endFrame);
  });

  it("clamps endFrame to the composition's own last real frame, never past it", () => {
    const result = computeDiagnosticFrameRange(2.5, 30, 2.4, 2.8);
    // durationSeconds=2.5s @ 30fps = 75 frames total, last real frame index 74
    expect(result.endFrame).toBe(74);
  });

  it("clamps startFrame to 0, never negative", () => {
    const result = computeDiagnosticFrameRange(5, 30, -1, 2.8);
    expect(result.startFrame).toBe(0);
  });
});
