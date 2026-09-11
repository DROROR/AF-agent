import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { conversionCopyPath, prepareConversionCopy } from "../legacy-project-conversion.js";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function makeSourceProject(content = "fake-legacy-aep-bytes"): { root: string; sourcePath: string; sha256: string } {
  const root = mkdtempSync(join(tmpdir(), "legacy-project-conversion-test-"));
  cleanupDirs.push(root);
  const sourcePath = join(root, "dro tempelate.aep");
  writeFileSync(sourcePath, content);
  return { root, sourcePath, sha256: sha256(content) };
}

describe("conversionCopyPath", () => {
  it("is deterministic - the same sha256 always maps to the same path, regardless of the source's own name", () => {
    const workRoot = "/fake/work-root";
    const a = conversionCopyPath(workRoot, "abc123");
    const b = conversionCopyPath(workRoot, "abc123");
    expect(a).toBe(b);
  });

  it("is keyed by sha256, not by source path or filename - never hardcoded to any one template", () => {
    const workRoot = "/fake/work-root";
    const forDroTempelate = conversionCopyPath(workRoot, "shared-hash");
    const forSomeOtherTemplate = conversionCopyPath(workRoot, "shared-hash");
    expect(forDroTempelate).toBe(forSomeOtherTemplate);
    expect(conversionCopyPath(workRoot, "different-hash")).not.toBe(forDroTempelate);
  });
});

describe("prepareConversionCopy - real 2026-09-11 incident (AE version 23.2.1 -> 26.3x87 candidate)", () => {
  it("copies the source into a deterministic, sha256-keyed location, leaving the original completely untouched", async () => {
    const { root, sourcePath, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const result = await prepareConversionCopy({ workRoot, sourceProjectPath: sourcePath });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyExisted).toBe(false);
    expect(result.sourceSha256).toBe(expectedSha);
    expect(result.conversionCopyPath).toBe(conversionCopyPath(workRoot, expectedSha));
    expect(existsSync(result.conversionCopyPath)).toBe(true);
    expect(readFileSync(result.conversionCopyPath, "utf8")).toBe("fake-legacy-aep-bytes");

    // The original source file itself: same bytes, same path, never opened or mutated.
    expect(readFileSync(sourcePath, "utf8")).toBe("fake-legacy-aep-bytes");
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(expectedSha);
  });

  it("never re-copies over an existing conversion copy - a human may already be mid-way through converting/saving it", async () => {
    const { root, sourcePath } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const first = await prepareConversionCopy({ workRoot, sourceProjectPath: sourcePath });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulate a human having manually converted-and-saved the copy - different bytes now.
    writeFileSync(first.conversionCopyPath, "human-converted-bytes-do-not-overwrite");

    const second = await prepareConversionCopy({ workRoot, sourceProjectPath: sourcePath });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyExisted).toBe(true);
    expect(second.conversionCopyPath).toBe(first.conversionCopyPath);
    // Never overwritten - the human's converted content survives.
    expect(readFileSync(second.conversionCopyPath, "utf8")).toBe("human-converted-bytes-do-not-overwrite");
  });

  it("reports a clear failure reason (never throws) when the source file does not exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "legacy-project-conversion-test-"));
    cleanupDirs.push(root);
    const workRoot = join(root, "work-root");
    const missingPath = join(root, "does-not-exist.aep");

    const result = await prepareConversionCopy({ workRoot, sourceProjectPath: missingPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/could not hash/i);
  });

  it("produces genuinely different destinations for two different source files with different content", async () => {
    const { root, sourcePath: sourceA } = makeSourceProject("content-a");
    const sourceB = join(root, "b.aep");
    writeFileSync(sourceB, "content-b");
    const workRoot = join(root, "work-root");

    const resultA = await prepareConversionCopy({ workRoot, sourceProjectPath: sourceA });
    const resultB = await prepareConversionCopy({ workRoot, sourceProjectPath: sourceB });

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;
    expect(resultA.conversionCopyPath).not.toBe(resultB.conversionCopyPath);
  });
});
