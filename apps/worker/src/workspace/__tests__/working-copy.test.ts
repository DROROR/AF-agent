import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareSessionWorkingCopy, sessionWorkingCopyPath } from "../working-copy.js";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function makeSourceProject(content = "fake-aep-bytes"): { root: string; sourcePath: string; sha256: string } {
  const root = mkdtempSync(join(tmpdir(), "working-copy-test-"));
  cleanupDirs.push(root);
  const sourcePath = join(root, "source.aep");
  writeFileSync(sourcePath, content);
  return { root, sourcePath, sha256: sha256(content) };
}

describe("prepareSessionWorkingCopy - a session's FIRST scene job (expectedWorkingProjectSha256: null)", () => {
  it("copies the source into a session-scoped working copy, leaving the original untouched", async () => {
    const { root, sourcePath, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const result = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-1",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: expectedSha,
      expectedWorkingProjectSha256: null
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resumed).toBe(false);
    expect(result.workingProjectPath).toBe(sessionWorkingCopyPath(workRoot, "session-1"));
    expect(result.sourceProjectSha256).toBe(expectedSha);
    expect(result.workingProjectSha256).toBe(expectedSha);

    // Original untouched - same bytes, same hash, still at its own path.
    expect(readFileSync(sourcePath, "utf8")).toBe("fake-aep-bytes");
    expect(readFileSync(result.workingProjectPath, "utf8")).toBe("fake-aep-bytes");
  });

  it("refuses when the source and derived working-copy paths would resolve to the same file", async () => {
    const { root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");
    // Force a collision: point workRoot/execution-sessions/session-collide/working-copy.aep AT
    // the source file's own parent, by making the "source" itself already sit exactly where a
    // working copy would be derived to.
    const collidingSessionId = "session-collide";
    const derivedPath = sessionWorkingCopyPath(workRoot, collidingSessionId);
    mkdirSync(derivedPath.replace(/working-copy\.aep$/, ""), { recursive: true });
    writeFileSync(derivedPath, "fake-aep-bytes");

    const result = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: collidingSessionId,
      sourceProjectPath: derivedPath, // deliberately identical to the derived working-copy path
      expectedSourceSha256: expectedSha,
      expectedWorkingProjectSha256: null
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("SAME_PATH");
  });

  it("refuses when the source no longer matches the expected sha256", async () => {
    const { sourcePath, root } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const result = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-2",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: "f".repeat(64), // wrong on purpose
      expectedWorkingProjectSha256: null
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("SOURCE_SHA_MISMATCH");
  });

  it("refuses when the source file does not exist at all", async () => {
    const root = mkdtempSync(join(tmpdir(), "working-copy-test-"));
    cleanupDirs.push(root);
    const workRoot = join(root, "work-root");

    const result = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-3",
      sourceProjectPath: join(root, "does-not-exist.aep"),
      expectedSourceSha256: "a".repeat(64),
      expectedWorkingProjectSha256: null
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("SOURCE_NOT_FOUND");
  });

  it("resumes by reusing an existing valid working copy, never re-copying over it", async () => {
    const { sourcePath, root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const first = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-4",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: expectedSha,
      expectedWorkingProjectSha256: null
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulate an in-progress edit already applied to the working copy - a
    // resume must never clobber this by re-copying the pristine source
    // over it.
    writeFileSync(first.workingProjectPath, "fake-aep-bytes-WITH-EDIT-APPLIED");

    const second = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-4",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: expectedSha,
      expectedWorkingProjectSha256: null
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.resumed).toBe(true);
    expect(readFileSync(second.workingProjectPath, "utf8")).toBe("fake-aep-bytes-WITH-EDIT-APPLIED");
  });

  it("refuses to resume from a zero-byte (corrupt) existing working copy", async () => {
    const { sourcePath, root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");
    const destPath = sessionWorkingCopyPath(workRoot, "session-5");
    mkdirSync(destPath.replace(/working-copy\.aep$/, ""), { recursive: true });
    writeFileSync(destPath, "");

    const result = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-5",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: expectedSha,
      expectedWorkingProjectSha256: null
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("WORKING_COPY_INVALID");
  });

  it("is idempotent - creating the workspace directory twice never throws", async () => {
    const { sourcePath, root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const first = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-6",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: expectedSha,
      expectedWorkingProjectSha256: null
    });
    const second = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-6",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: expectedSha,
      expectedWorkingProjectSha256: null
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it("blocks a path-traversal attempt in the execution session ID before ever touching the filesystem", async () => {
    const { sourcePath, root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    await expect(
      prepareSessionWorkingCopy({
        workRoot,
        executionSessionId: "../../etc",
        sourceProjectPath: sourcePath,
        expectedSourceSha256: expectedSha,
        expectedWorkingProjectSha256: null
      })
    ).rejects.toThrow();
  });

  it("derives the same deterministic working-copy path for the same (workRoot, executionSessionId) every time", () => {
    const a = sessionWorkingCopyPath("/work", "session-7");
    const b = sessionWorkingCopyPath("/work", "session-7");
    expect(a).toBe(b);
    expect(a.endsWith("working-copy.aep")).toBe(true);
  });
});

describe("prepareSessionWorkingCopy - accumulation across multiple scene jobs in the SAME session (chain of custody)", () => {
  it("scene 2's job continues from scene 1's own edited content, never a fresh copy from the original source", async () => {
    const { sourcePath, root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const scene1 = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-8",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: expectedSha,
      expectedWorkingProjectSha256: null
    });
    expect(scene1.ok).toBe(true);
    if (!scene1.ok) return;

    // Simulate scene 1's real edit landing on disk, and the API durably
    // recording the resulting sha256 as this session's new chain-of-custody head.
    writeFileSync(scene1.workingProjectPath, "fake-aep-bytes-AFTER-SCENE-1");
    const shaAfterScene1 = sha256("fake-aep-bytes-AFTER-SCENE-1");

    const scene2 = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-8",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: expectedSha,
      expectedWorkingProjectSha256: shaAfterScene1
    });
    expect(scene2.ok).toBe(true);
    if (!scene2.ok) return;
    expect(scene2.resumed).toBe(true);
    expect(scene2.workingProjectPath).toBe(scene1.workingProjectPath);
    expect(readFileSync(scene2.workingProjectPath, "utf8")).toBe("fake-aep-bytes-AFTER-SCENE-1");
  });

  it("fails closed with WORKING_COPY_MISSING when a later scene job expects a working copy that isn't there", async () => {
    const { sourcePath, root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const result = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-9",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: expectedSha,
      expectedWorkingProjectSha256: "d".repeat(64) // claims a prior scene succeeded, but nothing was ever created
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("WORKING_COPY_MISSING");
    // Never silently created from the original source.
    expect(() => readFileSync(sessionWorkingCopyPath(workRoot, "session-9"))).toThrow();
  });

  it("fails closed with WORKING_COPY_SHA_MISMATCH when the on-disk working copy disagrees with the session's own expected sha256", async () => {
    const { sourcePath, root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const scene1 = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-10",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: expectedSha,
      expectedWorkingProjectSha256: null
    });
    expect(scene1.ok).toBe(true);
    if (!scene1.ok) return;

    const result = await prepareSessionWorkingCopy({
      workRoot,
      executionSessionId: "session-10",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: expectedSha,
      expectedWorkingProjectSha256: "e".repeat(64) // disagrees with the real on-disk sha256
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("WORKING_COPY_SHA_MISMATCH");
    // The existing file is never overwritten/discarded on a mismatch.
    expect(readFileSync(scene1.workingProjectPath, "utf8")).toBe("fake-aep-bytes");
  });
});
