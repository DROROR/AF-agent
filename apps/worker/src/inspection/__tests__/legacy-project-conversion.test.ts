import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { conversionCopyDirectory, prepareConversionCopy, FREE_SPACE_MARGIN_BYTES } from "../legacy-project-conversion.js";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** A realistic template package: the .aep plus the sibling (Footage) folder its footage lives in. */
function makeTemplatePackage(content = "fake-legacy-aep-bytes"): { root: string; templateDir: string; sourcePath: string; sha256: string } {
  const root = mkdtempSync(join(tmpdir(), "legacy-project-conversion-test-"));
  cleanupDirs.push(root);
  const templateDir = join(root, "596");
  mkdirSync(join(templateDir, "(Footage)"), { recursive: true });
  const sourcePath = join(templateDir, "App_Promo.aep");
  writeFileSync(sourcePath, content);
  writeFileSync(join(templateDir, "(Footage)", "clip1.mp4"), "video-bytes");
  writeFileSync(join(templateDir, "(Footage)", "logo.png"), "image-bytes");
  return { root, templateDir, sourcePath, sha256: sha256(content) };
}

describe("conversionCopyDirectory", () => {
  it("is deterministic and keyed by sha256, never by the source's own path or filename", () => {
    const workRoot = "/fake/work-root";
    expect(conversionCopyDirectory(workRoot, "abc123")).toBe(conversionCopyDirectory(workRoot, "abc123"));
    expect(conversionCopyDirectory(workRoot, "different")).not.toBe(conversionCopyDirectory(workRoot, "abc123"));
  });
});

describe("prepareConversionCopy - real 2026-09-12 incident: an .aep-only copy orphaned its footage and produced 17 phantom 'missing footage' items", () => {
  it("copies the WHOLE template package, preserving the sibling (Footage) layout the project's footage depends on", async () => {
    const { root, sourcePath, sha256: expectedSha } = makeTemplatePackage();
    const workRoot = join(root, "work-root");

    const result = await prepareConversionCopy({ workRoot, sourceProjectPath: sourcePath });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packagePreserved).toBe(true);
    expect(result.sourceSha256).toBe(expectedSha);
    expect(existsSync(result.conversionCopyPath)).toBe(true);
    expect(readFileSync(result.conversionCopyPath, "utf8")).toBe("fake-legacy-aep-bytes");

    // The footage sits in the SAME relative position beside the copied project,
    // which is the whole point - otherwise AE reports it all as missing.
    const copiedFootage = join(result.conversionCopyPath, "..", "(Footage)", "clip1.mp4");
    expect(existsSync(copiedFootage)).toBe(true);
    expect(readFileSync(copiedFootage, "utf8")).toBe("video-bytes");
    expect(existsSync(join(result.conversionCopyPath, "..", "(Footage)", "logo.png"))).toBe(true);
  });

  it("keeps the copied project's own filename, so a template referencing itself by name still resolves", async () => {
    const { root, sourcePath } = makeTemplatePackage();
    const workRoot = join(root, "work-root");

    const result = await prepareConversionCopy({ workRoot, sourceProjectPath: sourcePath });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversionCopyPath.endsWith("App_Promo.aep")).toBe(true);
  });

  it("leaves the original template completely untouched", async () => {
    const { root, sourcePath, templateDir, sha256: expectedSha } = makeTemplatePackage();
    const workRoot = join(root, "work-root");

    await prepareConversionCopy({ workRoot, sourceProjectPath: sourcePath });

    expect(readFileSync(sourcePath, "utf8")).toBe("fake-legacy-aep-bytes");
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(expectedSha);
    expect(existsSync(join(templateDir, "(Footage)", "clip1.mp4"))).toBe(true);
  });

  it("never re-copies over an existing conversion copy - a human may already be mid-way through converting and saving it", async () => {
    const { root, sourcePath } = makeTemplatePackage();
    const workRoot = join(root, "work-root");

    const first = await prepareConversionCopy({ workRoot, sourceProjectPath: sourcePath });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    writeFileSync(first.conversionCopyPath, "human-converted-bytes-do-not-overwrite");

    const second = await prepareConversionCopy({ workRoot, sourceProjectPath: sourcePath });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyExisted).toBe(true);
    expect(second.conversionCopyPath).toBe(first.conversionCopyPath);
    expect(readFileSync(second.conversionCopyPath, "utf8")).toBe("human-converted-bytes-do-not-overwrite");
  });

  it("falls back to an .aep-only copy, and says so explicitly, when the containing folder is too large to copy safely", async () => {
    const { root, sourcePath } = makeTemplatePackage();
    const workRoot = join(root, "work-root");

    // A real guard rather than a mocked one: exceed the file-count bound.
    const bulk = join(root, "596", "bulk");
    mkdirSync(bulk, { recursive: true });
    for (let i = 0; i < 5_001; i++) {
      writeFileSync(join(bulk, `f${i}.bin`), "x");
    }

    const result = await prepareConversionCopy({ workRoot, sourceProjectPath: sourcePath });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packagePreserved).toBe(false);
    // The caller must be able to say that a resulting "missing footage" count
    // describes THIS COPY, not the template.
    expect(result.packageNote).toMatch(/will NOT resolve/i);
    expect(existsSync(result.conversionCopyPath)).toBe(true);
  }, 30_000);

  it("MIGRATION: an existing legacy .aep-only copy no longer blocks the package - it is carried into it, preserving a conversion already done by hand", async () => {
    const { root, sourcePath } = makeTemplatePackage();
    const workRoot = join(root, "work-root");
    const sha = sha256("fake-legacy-aep-bytes");

    // Exactly the stale layout an earlier build produced: <dir>/converted.aep,
    // holding a project a human already converted and saved.
    const legacyDir = join(workRoot, "template-conversions", sha);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "converted.aep"), "human-converted-bytes");

    const result = await prepareConversionCopy({ workRoot, sourceProjectPath: sourcePath });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The package is genuinely built this time, not short-circuited.
    expect(result.packagePreserved).toBe(true);
    expect(result.conversionCopyPath.endsWith("App_Promo.aep")).toBe(true);
    // The human's converted bytes are what ends up in the package...
    expect(readFileSync(result.conversionCopyPath, "utf8")).toBe("human-converted-bytes");
    // ...with the footage now beside it, which was the whole problem.
    expect(existsSync(join(result.conversionCopyPath, "..", "(Footage)", "clip1.mp4"))).toBe(true);
    expect(result.packageNote).toMatch(/carried into this package/i);
  });

  it("REAL 2026-09-12 FAILURE: never fills the disk - falls back to an .aep-only copy, naming the real shortfall, when the package will not fit", async () => {
    const { root, sourcePath } = makeTemplatePackage();
    const workRoot = join(root, "work-root");

    // Demand more headroom than any test machine has free, which is exactly
    // the condition the real machine hit on (Footage)\\Pre-renders.
    const original = FREE_SPACE_MARGIN_BYTES;
    expect(original).toBeGreaterThan(0);

    const result = await prepareConversionCopy({ workRoot, sourceProjectPath: sourcePath, freeSpaceMarginBytes: Number.MAX_SAFE_INTEGER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packagePreserved).toBe(false);
    expect(result.packageNote).toMatch(/is free on the drive/i);
    expect(result.packageNote).toMatch(/will NOT resolve/i);
    // The .aep is still there to convert, and no partial package was left behind.
    expect(existsSync(result.conversionCopyPath)).toBe(true);
    expect(existsSync(join(workRoot, "template-conversions", sha256("fake-legacy-aep-bytes"), "package"))).toBe(false);
  });

  it("reports a clear failure reason (never throws) when the source file does not exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "legacy-project-conversion-test-"));
    cleanupDirs.push(root);

    const result = await prepareConversionCopy({ workRoot: join(root, "work-root"), sourceProjectPath: join(root, "nope.aep") });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/could not hash/i);
  });

  it("produces genuinely different destinations for two different templates", async () => {
    const a = makeTemplatePackage("content-a");
    const b = makeTemplatePackage("content-b");
    const workRoot = join(a.root, "work-root");

    const resultA = await prepareConversionCopy({ workRoot, sourceProjectPath: a.sourcePath });
    const resultB = await prepareConversionCopy({ workRoot, sourceProjectPath: b.sourcePath });

    expect(resultA.ok && resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;
    expect(resultA.conversionCopyPath).not.toBe(resultB.conversionCopyPath);
  });
});
