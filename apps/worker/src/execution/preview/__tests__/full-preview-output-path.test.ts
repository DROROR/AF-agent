import { describe, expect, it } from "vitest";
import { fullPreviewOutputFilename, fullPreviewOutputPath } from "../full-preview-output-path.js";

describe("fullPreviewOutputPath / fullPreviewOutputFilename", () => {
  it("CREATE_PREVIEW's output filename is always the real, non-empty, well-formed constant - the exact fact the 2026-09-10 incident report called into question", () => {
    const filename = fullPreviewOutputFilename();
    expect(filename).toBe("preview.mp4");
    expect(filename.length).toBeGreaterThan(".mp4".length);
  });

  it("the computed path's own basename is never empty, and always ends with the real filename", () => {
    const outputPath = fullPreviewOutputPath("/work-root", "job-1");
    expect(outputPath.endsWith("preview.mp4")).toBe(true);
    expect(outputPath.endsWith("\\.mp4")).toBe(false);
    expect(outputPath.endsWith("/.mp4")).toBe(false);
  });

  it("is deterministic and job-scoped - two different jobIds never collide", () => {
    const a = fullPreviewOutputPath("/work-root", "job-a");
    const b = fullPreviewOutputPath("/work-root", "job-b");
    expect(a).not.toBe(b);
    expect(a).toContain("job-a");
    expect(b).toContain("job-b");
  });
});
