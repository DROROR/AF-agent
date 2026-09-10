import { describe, expect, it } from "vitest";
import { buildAerenderArgs } from "../aerender-args.js";

describe("buildAerenderArgs", () => {
  it("builds the exact fixed, allowlisted argument sequence with no shell metacharacters", () => {
    const args = buildAerenderArgs({
      projectPath: "/work/jobs/job-1/working-copy.aep",
      compName: "Landscape Master",
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Source",
      outputPath: "/work/jobs/job-1/renders/landscape/output.mp4"
    });

    expect(args).toEqual([
      "-project",
      "/work/jobs/job-1/working-copy.aep",
      "-comp",
      "Landscape Master",
      "-RStemplate",
      "Best Settings",
      "-OMtemplate",
      "H.264 - Match Source",
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
    const args = buildAerenderArgs({
      projectPath: "/p.aep",
      compName: "C",
      renderSettingsTemplateName: "R",
      outputModuleTemplateName: "O",
      outputPath: "/out.mp4"
    });
    expect(args).not.toContain("-verbose");
  });

  it("the '-v' flag is always followed by exactly one of Adobe's own real, documented enum values - never the invented 'ERRORS_AND_WARNINGS'", () => {
    const args = buildAerenderArgs({
      projectPath: "/p.aep",
      compName: "C",
      renderSettingsTemplateName: "R",
      outputModuleTemplateName: "O",
      outputPath: "/out.mp4"
    });
    const vIndex = args.indexOf("-v");
    expect(vIndex).toBeGreaterThan(-1);
    const value = args[vIndex + 1];
    expect(["ERRORS", "ERRORS_AND_PROGRESS"]).toContain(value);
    expect(value).not.toBe("ERRORS_AND_WARNINGS");
  });

  it("real 2026-09-10 incident fix: uses the preferred 'ERRORS_AND_PROGRESS' value specifically", () => {
    const args = buildAerenderArgs({
      projectPath: "/p.aep",
      compName: "C",
      renderSettingsTemplateName: "R",
      outputModuleTemplateName: "O",
      outputPath: "/out.mp4"
    });
    const vIndex = args.indexOf("-v");
    expect(args[vIndex + 1]).toBe("ERRORS_AND_PROGRESS");
  });

  it("CREATE_PREVIEW and RENDER share this exact same builder - there is only ever one canonical -v value for both", () => {
    const previewArgs = buildAerenderArgs({
      projectPath: "/work/jobs/job-1/working-copy.aep",
      compName: "!Render (Landscape)",
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps",
      outputPath: "/work/jobs/job-1/full-preview/preview.mp4"
    });
    const renderArgs = buildAerenderArgs({
      projectPath: "/work/jobs/job-2/working-copy.aep",
      compName: "!Render",
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps",
      outputPath: "/work/jobs/job-2/renders/reels/output.mp4"
    });
    expect(previewArgs[previewArgs.indexOf("-v") + 1]).toBe(renderArgs[renderArgs.indexOf("-v") + 1]);
  });

  it("never saves the project (always -close DO_NOT_SAVE_CHANGES) - rendering must never mutate the working copy", () => {
    const args = buildAerenderArgs({
      projectPath: "/p.aep",
      compName: "C",
      renderSettingsTemplateName: "R",
      outputModuleTemplateName: "O",
      outputPath: "/out.mp4"
    });
    const closeIndex = args.indexOf("-close");
    expect(args[closeIndex + 1]).toBe("DO_NOT_SAVE_CHANGES");
  });

  it("a project/output path containing spaces is passed through as ONE array element, never split into multiple argv tokens (spawn's own {shell:false} array form needs no quoting/escaping)", () => {
    const projectPath = "C:\\DYO-Agent\\copies\\dro template converted.aep";
    const outputPath = "C:\\DYO-Agent\\jobs\\job 1\\full-preview\\preview.mp4";
    const args = buildAerenderArgs({
      projectPath,
      compName: "C",
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps",
      outputPath
    });
    expect(args[args.indexOf("-project") + 1]).toBe(projectPath);
    expect(args[args.indexOf("-output") + 1]).toBe(outputPath);
    // Neither path was ever split into multiple array elements by an internal space.
    expect(args).toHaveLength(14);
  });

  it("passes a malicious-looking composition name through as ONE array element, never split into multiple shell-interpretable tokens", () => {
    const malicious = "Scene\"; rm -rf / #";
    const args = buildAerenderArgs({
      projectPath: "/p.aep",
      compName: malicious,
      renderSettingsTemplateName: "R",
      outputModuleTemplateName: "O",
      outputPath: "/out.mp4"
    });
    expect(args).toContain(malicious);
    expect(args.filter((a) => a.includes("rm -rf"))).toEqual([malicious]);
  });

  it("is deterministic - the same params always produce the same args", () => {
    const params = {
      projectPath: "/p.aep",
      compName: "C",
      renderSettingsTemplateName: "R",
      outputModuleTemplateName: "O",
      outputPath: "/out.mp4"
    };
    expect(buildAerenderArgs(params)).toEqual(buildAerenderArgs(params));
  });
});
