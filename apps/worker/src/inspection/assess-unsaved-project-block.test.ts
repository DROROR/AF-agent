import { describe, expect, it } from "vitest";
import { assessUnsavedProjectBlock } from "./assess-unsaved-project-block.js";
import type { CurrentProjectInfo } from "./parse-mcp-shapes.js";

function health(overrides: Partial<CurrentProjectInfo> = {}): CurrentProjectInfo {
  return { projectOpen: false, projectPath: null, projectName: null, numItems: null, ...overrides };
}

describe("assessUnsavedProjectBlock", () => {
  // The EXACT ae_health payload captured from job 48bf41d3 at 14:17:51Z.
  it("blocks on the real 2026-09-12 shape: Untitled, no path, 46 items", () => {
    const result = assessUnsavedProjectBlock(
      health({ projectOpen: true, projectPath: null, projectName: "Untitled", numItems: 46 })
    );

    expect(result.blocked).toBe(true);
    expect(result.projectName).toBe("Untitled");
    expect(result.itemCount).toBe(46);
  });

  it("gives the operator an exact, actionable instruction - never an opaque failure", () => {
    const result = assessUnsavedProjectBlock(
      health({ projectOpen: true, projectPath: null, projectName: "Untitled", numItems: 46 })
    );
    expect(result.reason).toContain("OPERATOR ACTION");
    expect(result.reason).toContain("File > Close Project");
    expect(result.reason).toContain("nothing was changed");
  });

  it("states plainly that the worker will not discard the unsaved work itself", () => {
    const result = assessUnsavedProjectBlock(
      health({ projectOpen: true, projectPath: null, projectName: "Untitled", numItems: 46 })
    );
    expect(result.reason).toMatch(/will not close it for you/);
  });

  it("does NOT block when no project is open", () => {
    expect(assessUnsavedProjectBlock(health({ projectOpen: false })).blocked).toBe(false);
  });

  // AE's empty default project is replaced silently by app.open() with no
  // prompt - blocking on it would strand every inspection on a fresh AE.
  it("does NOT block on AE's empty default project (0 items)", () => {
    expect(
      assessUnsavedProjectBlock(health({ projectOpen: true, projectPath: null, projectName: "Untitled", numItems: 0 })).blocked
    ).toBe(false);
  });

  it("does NOT block on a SAVED project, however many items it has", () => {
    expect(
      assessUnsavedProjectBlock(
        health({ projectOpen: true, projectPath: "C:\\DYO-Agent\\copies\\x\\App_Promo.aep", projectName: "App_Promo.aep", numItems: 120 })
      ).blocked
    ).toBe(false);
  });

  // Failing closed here would block EVERY inspection on any bridge version
  // that omits numItems. Failing open costs one 30s timeout and a clear,
  // recoverable error.
  it("does NOT block when the item count was not reported at all", () => {
    expect(
      assessUnsavedProjectBlock(health({ projectOpen: true, projectPath: null, projectName: "Untitled", numItems: null })).blocked
    ).toBe(false);
  });

  it("falls back to a readable label when AE reports no project name", () => {
    const result = assessUnsavedProjectBlock(health({ projectOpen: true, projectPath: null, projectName: null, numItems: 3 }));
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("an untitled project");
  });

  it("carries no reason at all when it does not block", () => {
    expect(assessUnsavedProjectBlock(health({ projectOpen: false })).reason).toBeUndefined();
  });
});
