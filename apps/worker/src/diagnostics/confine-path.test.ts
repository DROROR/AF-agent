import { describe, expect, it } from "vitest";
import { confineToWorkRoot, isInsideWorkRoot, PathOutsideWorkRootError } from "./confine-path.js";

const root = process.platform === "win32" ? "C:\\DYO-Agent" : "/dyo-agent";
const sibling = process.platform === "win32" ? "C:\\DYO-Agent-secrets" : "/dyo-agent-secrets";

describe("confineToWorkRoot", () => {
  it("accepts the work root itself", () => {
    expect(confineToWorkRoot(root, ".")).toBe(confineToWorkRoot(root, ""));
  });

  it("accepts a real file inside the work root", () => {
    expect(confineToWorkRoot(root, "logs/worker.log")).toContain("worker.log");
  });

  it("rejects a traversal escape", () => {
    expect(() => confineToWorkRoot(root, "../../Windows/System32/config/SAM")).toThrow(PathOutsideWorkRootError);
  });

  it("rejects a traversal that re-enters through the middle of the path", () => {
    expect(() => confineToWorkRoot(root, "logs/../../elsewhere/file.txt")).toThrow(PathOutsideWorkRootError);
  });

  it("rejects a SIBLING directory sharing the root's name prefix - the bug a string prefix check would let through", () => {
    expect(() => confineToWorkRoot(root, sibling)).toThrow(PathOutsideWorkRootError);
    expect(isInsideWorkRoot(root, sibling)).toBe(false);
  });

  it("rejects an unrelated absolute path", () => {
    const outside = process.platform === "win32" ? "C:\\Users\\Fahad Nakash\\.ssh\\id_rsa" : "/etc/shadow";
    expect(() => confineToWorkRoot(root, outside)).toThrow(PathOutsideWorkRootError);
  });

  it("refuses a relative work root outright rather than resolving it against the process cwd", () => {
    expect(() => confineToWorkRoot("relative-root", "file.txt")).toThrow(/absolute path/);
  });

  it("names the work root in the error so a refusal is actionable", () => {
    try {
      confineToWorkRoot(root, sibling);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as PathOutsideWorkRootError).workRoot).toBe(root);
    }
  });
});
