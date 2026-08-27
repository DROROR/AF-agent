import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateRenderArtifact } from "../validate-render-artifact.js";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "validate-render-artifact-test-"));
  cleanupDirs.push(dir);
  return dir;
}

describe("validateRenderArtifact", () => {
  it("succeeds for a real, non-empty regular file and reports its exact byte size", () => {
    const dir = tempDir();
    const filePath = join(dir, "output.mp4");
    writeFileSync(filePath, Buffer.from([1, 2, 3, 4, 5]));

    const result = validateRenderArtifact(filePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.byteSize).toBe(statSync(filePath).size);
    expect(result.byteSize).toBe(5);
  });

  it("fails when the file does not exist", () => {
    const dir = tempDir();
    const result = validateRenderArtifact(join(dir, "does-not-exist.mp4"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("does not exist");
  });

  it("fails for a zero-byte file", () => {
    const dir = tempDir();
    const filePath = join(dir, "empty.mp4");
    writeFileSync(filePath, Buffer.alloc(0));

    const result = validateRenderArtifact(filePath);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("zero bytes");
  });

  it("fails when the path is a directory, not a regular file", () => {
    const dir = tempDir();
    const result = validateRenderArtifact(dir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not a regular file");
  });
});
