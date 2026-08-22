import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnsafePathError } from "../errors/worker-error.js";
import { ensureWorkRoot, jobWorkspacePath, resolveWorkRoot, safeJoin } from "./work-root.js";

describe("resolveWorkRoot", () => {
  it("resolves a relative path to an absolute one", () => {
    const resolved = resolveWorkRoot("./some-root");
    expect(path.isAbsolute(resolved)).toBe(true);
  });
});

describe("safeJoin", () => {
  const root = "/opt/dyo-agent-work-root";

  it("joins a simple relative segment inside the root", () => {
    expect(safeJoin(root, "jobs", "job-1")).toBe(path.join(root, "jobs", "job-1"));
  });

  it("rejects a traversal attempt with ..", () => {
    expect(() => safeJoin(root, "..", "..", "etc", "passwd")).toThrow(UnsafePathError);
  });

  it("rejects a traversal attempt hidden inside a single segment", () => {
    expect(() => safeJoin(root, "jobs/../../../etc/passwd")).toThrow(UnsafePathError);
  });

  it("rejects an absolute segment outright, regardless of where it would resolve", () => {
    expect(() => safeJoin(root, "/etc/passwd")).toThrow(UnsafePathError);
  });

  it("rejects a segment containing a null byte", () => {
    expect(() => safeJoin(root, "jobs\0evil")).toThrow(UnsafePathError);
  });

  it("allows the root itself with no extra segments", () => {
    expect(safeJoin(root)).toBe(path.resolve(root));
  });
});

describe("jobWorkspacePath", () => {
  const root = "/opt/dyo-agent-work-root";

  it("produces an isolated path per job ID under the root", () => {
    const jobA = jobWorkspacePath(root, "job-aaaa");
    const jobB = jobWorkspacePath(root, "job-bbbb");
    expect(jobA).not.toBe(jobB);
    expect(jobA.startsWith(path.resolve(root) + path.sep)).toBe(true);
    expect(jobB.startsWith(path.resolve(root) + path.sep)).toBe(true);
  });

  it("rejects a job ID that is actually a path traversal attempt", () => {
    expect(() => jobWorkspacePath(root, "../../etc/passwd")).toThrow(UnsafePathError);
  });

  it("rejects a job ID containing path separators", () => {
    expect(() => jobWorkspacePath(root, "job/../evil")).toThrow(UnsafePathError);
  });
});

describe("ensureWorkRoot", () => {
  let tempParent: string;

  beforeEach(() => {
    tempParent = mkdtempSync(path.join(os.tmpdir(), "dyo-worker-test-"));
  });

  afterEach(() => {
    rmSync(tempParent, { recursive: true, force: true });
  });

  it("creates a nested work root that does not yet exist", () => {
    const target = path.join(tempParent, "nested", "work-root");
    ensureWorkRoot(target);
    // A second call must not throw even though the directory already exists.
    ensureWorkRoot(target);
  });
});
