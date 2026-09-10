import { describe, expect, it } from "vitest";
import { assertValidOutputBasename } from "../output-basename.js";
import { UnsafePathError } from "../../errors/worker-error.js";

/**
 * Live QA, 2026-09-10 real incident audit (session dac9fc90, job
 * dac9fc90-ed8b-4589-9fe5-d34d4f95aa95): the operator reported the failed
 * job's expected output path as "...\full-preview\preview\.mp4" - a
 * basename of just ".mp4" with nothing before the dot. The real durable
 * job result actually showed a well-formed "preview.mp4" (confirmed by
 * direct read of jobs.result and of full-preview-output-path.ts's own
 * fixed OUTPUT_FILENAME constant) - the real root cause was a mismatched
 * Render Settings template name, not an empty basename. These tests exist
 * so the operator's own reported failure MODE - a basename that is empty,
 * whitespace, or only an extension - can never actually happen in this
 * codebase, regardless of what the real incident's own root cause was.
 */
describe("assertValidOutputBasename", () => {
  it("accepts a well-formed basename and returns it unchanged", () => {
    expect(assertValidOutputBasename("preview.mp4", ".mp4")).toBe("preview.mp4");
  });

  it("accepts the expected extension given without its leading dot too", () => {
    expect(assertValidOutputBasename("output.mp4", "mp4")).toBe("output.mp4");
  });

  it("trims surrounding whitespace", () => {
    expect(assertValidOutputBasename("  preview.mp4  ", ".mp4")).toBe("preview.mp4");
  });

  it("rejects an empty basename", () => {
    expect(() => assertValidOutputBasename("", ".mp4")).toThrow(UnsafePathError);
  });

  it("rejects a whitespace-only basename", () => {
    expect(() => assertValidOutputBasename("   ", ".mp4")).toThrow(UnsafePathError);
  });

  it("the exact reported incident shape: a basename that is ONLY the extension, with nothing before the dot", () => {
    expect(() => assertValidOutputBasename(".mp4", ".mp4")).toThrow(/only an extension/);
  });

  it("rejects a basename containing a forward slash", () => {
    expect(() => assertValidOutputBasename("sub/preview.mp4", ".mp4")).toThrow(UnsafePathError);
  });

  it("rejects a basename containing a backslash", () => {
    expect(() => assertValidOutputBasename("sub\\preview.mp4", ".mp4")).toThrow(UnsafePathError);
  });

  it("rejects a basename containing a null byte", () => {
    expect(() => assertValidOutputBasename("preview\0.mp4", ".mp4")).toThrow(UnsafePathError);
  });

  it("rejects the path traversal segments '.' and '..' outright", () => {
    expect(() => assertValidOutputBasename(".", ".mp4")).toThrow(UnsafePathError);
    expect(() => assertValidOutputBasename("..", ".mp4")).toThrow(UnsafePathError);
  });

  it("rejects a basename that does not end with the expected extension", () => {
    expect(() => assertValidOutputBasename("preview.mov", ".mp4")).toThrow(/does not end with the expected extension/);
  });

  it("extension matching is case-insensitive", () => {
    expect(assertValidOutputBasename("preview.MP4", ".mp4")).toBe("preview.MP4");
  });

  it("normalizes the extension exactly once - rejects a doubled extension", () => {
    expect(() => assertValidOutputBasename("preview.mp4.mp4", ".mp4")).toThrow(/more than once/);
  });

  it("every UnsafePathError thrown here carries the real invalid value in its own message, never a generic/opaque error", () => {
    let caught: unknown = null;
    try {
      assertValidOutputBasename("", ".mp4");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsafePathError);
    expect((caught as UnsafePathError).message).toContain('""');
  });
});
