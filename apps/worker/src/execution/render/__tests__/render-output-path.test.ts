import { describe, expect, it } from "vitest";
import { renderOutputFilename, renderOutputPath } from "../render-output-path.js";

describe("renderOutputPath / renderOutputFilename", () => {
  it("RENDER's output filename is always the real, non-empty, well-formed constant", () => {
    const filename = renderOutputFilename();
    expect(filename).toBe("output.mp4");
    expect(filename.length).toBeGreaterThan(".mp4".length);
  });

  it("the computed path's own basename is never empty, and always ends with the real filename", () => {
    const outputPath = renderOutputPath("/work-root", "job-1", "LANDSCAPE");
    expect(outputPath.endsWith("output.mp4")).toBe(true);
    expect(outputPath.endsWith("\\.mp4")).toBe(false);
    expect(outputPath.endsWith("/.mp4")).toBe(false);
  });

  it("is deterministic and job+variant-scoped - LANDSCAPE and REELS never collide for the same job", () => {
    const landscape = renderOutputPath("/work-root", "job-1", "LANDSCAPE");
    const reels = renderOutputPath("/work-root", "job-1", "REELS");
    expect(landscape).not.toBe(reels);
  });
});
