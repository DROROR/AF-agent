import { describe, expect, it } from "vitest";
import { buildAerenderArgs, computeFullCompositionFrameRange, type AerenderArgsParams } from "../aerender-args.js";

function params(overrides: Partial<AerenderArgsParams> = {}): AerenderArgsParams {
  return {
    projectPath: "/work/jobs/job-1/working-copy.aep",
    compName: "Landscape Master",
    renderSettingsTemplateName: "Best Settings",
    outputModuleTemplateName: "H.264 - Match Source",
    outputPath: "/work/jobs/job-1/renders/landscape/output.mp4",
    startFrame: 0,
    endFrame: 1349,
    ...overrides
  };
}

describe("buildAerenderArgs", () => {
  it("builds the exact fixed, allowlisted argument sequence with no shell metacharacters", () => {
    const args = buildAerenderArgs(params());

    expect(args).toEqual([
      "-project",
      "/work/jobs/job-1/working-copy.aep",
      "-comp",
      "Landscape Master",
      "-RStemplate",
      "Best Settings",
      "-OMtemplate",
      "H.264 - Match Source",
      "-s",
      "0",
      "-e",
      "1349",
      "-output",
      "/work/jobs/job-1/renders/landscape/output.mp4",
      "-close",
      "DO_NOT_SAVE_CHANGES",
      "-v",
      "ERRORS_AND_PROGRESS"
    ]);
  });

  /**
   * Real 2026-09-10 incident (job ea99c6dd-359d-4c02-ab3b-01687a1d8cf3, AE
   * 26.3x87): a real client run failed immediately with "aerender SYNTAX
   * ERROR: Bad value for -verbose." because the value passed alongside -v
   * was "ERRORS_AND_WARNINGS", which AE's own aerender does not actually
   * recognize. These tests exist so an invalid -v value (or the wrong flag
   * name entirely) can never silently regress back in.
   */
  it("never emits a '-verbose' argument - the real, valid Adobe flag is the short form '-v'", () => {
    const args = buildAerenderArgs(params());
    expect(args).not.toContain("-verbose");
  });

  it("the '-v' flag is always followed by exactly one of Adobe's own real, documented enum values - never the invented 'ERRORS_AND_WARNINGS'", () => {
    const args = buildAerenderArgs(params());
    const vIndex = args.indexOf("-v");
    expect(vIndex).toBeGreaterThan(-1);
    const value = args[vIndex + 1];
    expect(["ERRORS", "ERRORS_AND_PROGRESS"]).toContain(value);
    expect(value).not.toBe("ERRORS_AND_WARNINGS");
  });

  it("real 2026-09-10 incident fix: uses the preferred 'ERRORS_AND_PROGRESS' value specifically", () => {
    const args = buildAerenderArgs(params());
    const vIndex = args.indexOf("-v");
    expect(args[vIndex + 1]).toBe("ERRORS_AND_PROGRESS");
  });

  it("CREATE_PREVIEW and RENDER share this exact same builder - there is only ever one canonical -v value for both", () => {
    const previewArgs = buildAerenderArgs(
      params({
        compName: "!Render (Landscape)",
        outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps",
        outputPath: "/work/jobs/job-1/full-preview/preview.mp4"
      })
    );
    const renderArgs = buildAerenderArgs(
      params({
        projectPath: "/work/jobs/job-2/working-copy.aep",
        compName: "!Render",
        outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps",
        outputPath: "/work/jobs/job-2/renders/reels/output.mp4"
      })
    );
    expect(previewArgs[previewArgs.indexOf("-v") + 1]).toBe(renderArgs[renderArgs.indexOf("-v") + 1]);
  });

  it("never saves the project (always -close DO_NOT_SAVE_CHANGES) - rendering must never mutate the working copy", () => {
    const args = buildAerenderArgs(params());
    const closeIndex = args.indexOf("-close");
    expect(args[closeIndex + 1]).toBe("DO_NOT_SAVE_CHANGES");
  });

  /**
   * Real 2026-09-10 incident, session a7fee3d9: without explicit -s/-e,
   * aerender falls back to whatever "Time Span" the named Render Settings
   * template itself specifies - on this real project, "Best Settings"
   * turned out to mean "Work Area Only" (31.7317s), narrower than the
   * composition's own real duration (45.045s), silently truncating every
   * render. These tests exist so a full-duration render can never
   * silently regress back to the work area.
   */
  it("real 2026-09-10 incident fix: always emits explicit -s/-e, overriding whatever Time Span the named Render Settings template specifies", () => {
    const args = buildAerenderArgs(params({ startFrame: 0, endFrame: 1349 }));
    expect(args).toContain("-s");
    expect(args).toContain("-e");
    const sIndex = args.indexOf("-s");
    const eIndex = args.indexOf("-e");
    expect(args[sIndex + 1]).toBe("0");
    expect(args[eIndex + 1]).toBe("1349");
  });

  it("the real incident's own exact numbers: startFrame 0, endFrame 1349 for a 45.045045s/29.97fps composition - the full comp, never the 31.7317s work area", () => {
    // 45.045045045045 * 29.9700012207031 rounds to exactly 1350 frames; the last 0-based frame is 1349.
    const totalFrames = Math.round(45.045045045045 * 29.9700012207031);
    expect(totalFrames).toBe(1350);
    const args = buildAerenderArgs(params({ startFrame: 0, endFrame: totalFrames - 1 }));
    expect(args[args.indexOf("-e") + 1]).toBe("1349");
  });

  it("-s/-e are always placed BEFORE -output, so aerender never has any ambiguity about which time span applies to which output", () => {
    const args = buildAerenderArgs(params());
    expect(args.indexOf("-s")).toBeLessThan(args.indexOf("-output"));
    expect(args.indexOf("-e")).toBeLessThan(args.indexOf("-output"));
  });

  it("a project/output path containing spaces is passed through as ONE array element, never split into multiple argv tokens (spawn's own {shell:false} array form needs no quoting/escaping)", () => {
    const projectPath = "C:\\DYO-Agent\\copies\\dro template converted.aep";
    const outputPath = "C:\\DYO-Agent\\jobs\\job 1\\full-preview\\preview.mp4";
    const args = buildAerenderArgs(params({ projectPath, outputPath }));
    expect(args[args.indexOf("-project") + 1]).toBe(projectPath);
    expect(args[args.indexOf("-output") + 1]).toBe(outputPath);
    // Neither path was ever split into multiple array elements by an internal space.
    expect(args).toHaveLength(18);
  });

  it("passes a malicious-looking composition name through as ONE array element, never split into multiple shell-interpretable tokens", () => {
    const malicious = "Scene\"; rm -rf / #";
    const args = buildAerenderArgs(params({ compName: malicious }));
    expect(args).toContain(malicious);
    expect(args.filter((a) => a.includes("rm -rf"))).toEqual([malicious]);
  });

  it("is deterministic - the same params always produce the same args", () => {
    const p = params();
    expect(buildAerenderArgs(p)).toEqual(buildAerenderArgs(p));
  });
});

describe("computeFullCompositionFrameRange (real 2026-09-10 incident, session a7fee3d9)", () => {
  it("the exact real incident numbers: a 45.045045s/29.97fps composition is exactly 1350 frames, last frame 1349", () => {
    expect(computeFullCompositionFrameRange(45.045045045045, 29.9700012207031)).toEqual({ startFrame: 0, endFrame: 1349 });
  });

  it("always starts at frame 0 - a full-composition render, never a caller-supplied or guessed start", () => {
    expect(computeFullCompositionFrameRange(10, 30).startFrame).toBe(0);
    expect(computeFullCompositionFrameRange(0.5, 24).startFrame).toBe(0);
  });

  it("rounds to the nearest real frame count rather than floor/ceil, since a real AE duration is always frameCount/frameRate exactly", () => {
    // 5 seconds at 30fps is exactly 150 frames - last frame 149.
    expect(computeFullCompositionFrameRange(5, 30)).toEqual({ startFrame: 0, endFrame: 149 });
  });

  it("never returns a negative endFrame for a degenerate near-zero duration", () => {
    expect(computeFullCompositionFrameRange(0, 30).endFrame).toBe(0);
  });
});
