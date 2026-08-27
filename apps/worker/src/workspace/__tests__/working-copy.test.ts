import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareWorkingCopy, workingCopyPath } from "../working-copy.js";

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

describe("prepareWorkingCopy", () => {
  it("copies the source into a job-scoped working copy, leaving the original untouched", async () => {
    const { root, sourcePath, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const result = await prepareWorkingCopy({
      workRoot,
      jobId: "job-1",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: expectedSha
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resumed).toBe(false);
    expect(result.workingProjectPath).toBe(workingCopyPath(workRoot, "job-1"));
    expect(result.sourceProjectSha256).toBe(expectedSha);
    expect(result.workingProjectSha256).toBe(expectedSha);

    // Original untouched - same bytes, same hash, still at its own path.
    expect(readFileSync(sourcePath, "utf8")).toBe("fake-aep-bytes");
    expect(readFileSync(result.workingProjectPath, "utf8")).toBe("fake-aep-bytes");
  });

  it("refuses when the source and derived working-copy paths would resolve to the same file", async () => {
    const { root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");
    // Force a collision: point workRoot/jobs/job-1/working-copy.aep AT the source file's own parent, by
    // making the "source" itself already sit exactly where a working copy would be derived to.
    const collidingJobId = "job-collide";
    const derivedPath = workingCopyPath(workRoot, collidingJobId);
    mkdirSync(derivedPath.replace(/working-copy\.aep$/, ""), { recursive: true });
    writeFileSync(derivedPath, "fake-aep-bytes");

    const result = await prepareWorkingCopy({
      workRoot,
      jobId: collidingJobId,
      sourceProjectPath: derivedPath, // deliberately identical to the derived working-copy path
      expectedSourceSha256: expectedSha
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("SAME_PATH");
  });

  it("refuses when the source no longer matches the expected sha256", async () => {
    const { sourcePath, root } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const result = await prepareWorkingCopy({
      workRoot,
      jobId: "job-2",
      sourceProjectPath: sourcePath,
      expectedSourceSha256: "f".repeat(64) // wrong on purpose
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("SOURCE_SHA_MISMATCH");
  });

  it("refuses when the source file does not exist at all", async () => {
    const root = mkdtempSync(join(tmpdir(), "working-copy-test-"));
    cleanupDirs.push(root);
    const workRoot = join(root, "work-root");

    const result = await prepareWorkingCopy({
      workRoot,
      jobId: "job-3",
      sourceProjectPath: join(root, "does-not-exist.aep"),
      expectedSourceSha256: "a".repeat(64)
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("SOURCE_NOT_FOUND");
  });

  it("resumes by reusing an existing valid working copy, never re-copying over it", async () => {
    const { sourcePath, root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const first = await prepareWorkingCopy({ workRoot, jobId: "job-4", sourceProjectPath: sourcePath, expectedSourceSha256: expectedSha });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulate an in-progress edit already applied to the working copy - a
    // resume must never clobber this by re-copying the pristine source
    // over it.
    writeFileSync(first.workingProjectPath, "fake-aep-bytes-WITH-EDIT-APPLIED");

    const second = await prepareWorkingCopy({ workRoot, jobId: "job-4", sourceProjectPath: sourcePath, expectedSourceSha256: expectedSha });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.resumed).toBe(true);
    expect(readFileSync(second.workingProjectPath, "utf8")).toBe("fake-aep-bytes-WITH-EDIT-APPLIED");
  });

  it("refuses to resume from a zero-byte (corrupt) existing working copy", async () => {
    const { sourcePath, root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");
    const destPath = workingCopyPath(workRoot, "job-5");
    mkdirSync(destPath.replace(/working-copy\.aep$/, ""), { recursive: true });
    writeFileSync(destPath, "");

    const result = await prepareWorkingCopy({ workRoot, jobId: "job-5", sourceProjectPath: sourcePath, expectedSourceSha256: expectedSha });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("WORKING_COPY_INVALID");
  });

  it("is idempotent - creating the workspace directory twice never throws", async () => {
    const { sourcePath, root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const first = await prepareWorkingCopy({ workRoot, jobId: "job-6", sourceProjectPath: sourcePath, expectedSourceSha256: expectedSha });
    const second = await prepareWorkingCopy({ workRoot, jobId: "job-6", sourceProjectPath: sourcePath, expectedSourceSha256: expectedSha });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it("blocks a path-traversal attempt in the job ID before ever touching the filesystem", async () => {
    const { sourcePath, root, sha256: expectedSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    await expect(
      prepareWorkingCopy({
        workRoot,
        jobId: "../../etc",
        sourceProjectPath: sourcePath,
        expectedSourceSha256: expectedSha
      })
    ).rejects.toThrow();
  });

  it("derives the same deterministic working-copy path for the same (workRoot, jobId) every time", () => {
    const a = workingCopyPath("/work", "job-7");
    const b = workingCopyPath("/work", "job-7");
    expect(a).toBe(b);
    expect(a.endsWith("working-copy.aep")).toBe(true);
  });
});
