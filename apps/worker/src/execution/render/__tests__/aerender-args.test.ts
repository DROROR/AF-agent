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
      "ERRORS_AND_WARNINGS"
    ]);
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
