import { describe, expect, it } from "vitest";
import { resolveNextAction, resolveTabLocks, type NextActionInput } from "./project-next-action";

/**
 * REAL 2026-09-25 INCIDENT: the operator who runs this dashboard daily could
 * not tell which step a project was on or which tab to open next. These
 * tests pin the two properties that make the replacement trustworthy: the
 * named action is always the one whose precondition is genuinely unmet, and
 * "we do not know" is a real, reachable answer rather than a fallback to a
 * plausible guess.
 */
function input(overrides: Partial<NextActionInput> = {}): NextActionInput {
  // A project sitting at the very start: plan created, nothing approved.
  return {
    stateUnknown: false,
    hasPlan: true,
    planApproved: false,
    scenesNeedingReview: 0,
    includedSceneCount: 2,
    executableSceneCount: 0,
    awaitingFirstPreviewApproval: false,
    firstPreviewApproved: false,
    allScenesComplete: false,
    landscapeRenderConfigured: false,
    fullPreviewApproved: false,
    hasRenderArtifact: false,
    ...overrides
  };
}

/** The same project, walked all the way to "everything is approved and configured". */
function readyToRender(overrides: Partial<NextActionInput> = {}): NextActionInput {
  return input({
    planApproved: true,
    executableSceneCount: 2,
    awaitingFirstPreviewApproval: false,
    firstPreviewApproved: true,
    allScenesComplete: true,
    landscapeRenderConfigured: true,
    fullPreviewApproved: true,
    ...overrides
  });
}

describe("resolveNextAction - never invents state", () => {
  it("answers 'unknown' while the real state is not known, whatever else the inputs happen to say", () => {
    // Deliberately hands it a fully-finished-looking project: if this ever
    // returned "done" (or any other confident answer) the UI would announce
    // a step it has not actually confirmed - the exact failure the incident
    // was about.
    const result = resolveNextAction(readyToRender({ stateUnknown: true, hasRenderArtifact: true }));
    expect(result).toEqual({ id: "unknown", tab: null });
  });

  it("never claims a tab is locked while the state is unknown - an unverified lock is its own wrong instruction", () => {
    expect(resolveTabLocks({ stateUnknown: true, hasPlan: false, planApproved: false, executableSceneCount: 0, fullPreviewApproved: false })).toEqual({
      preview: false,
      export: false
    });
  });
});

describe("resolveNextAction - the named action is the genuinely blocking one", () => {
  it("sends a project with no plan to Scenes to create one", () => {
    expect(resolveNextAction(input({ hasPlan: false }))).toEqual({ id: "createPlan", tab: "scenes" });
  });

  it("asks for review, not approval, while any included scene still needs a decision", () => {
    expect(resolveNextAction(input({ scenesNeedingReview: 1 }))).toEqual({ id: "reviewScenes", tab: "scenes" });
  });

  it("asks for approval once every included scene is reviewed", () => {
    expect(resolveNextAction(input({ scenesNeedingReview: 0 }))).toEqual({ id: "approveScenes", tab: "scenes" });
  });

  it("never offers 'approve' for a plan that includes no scenes at all - approving would produce no video", () => {
    expect(resolveNextAction(input({ scenesNeedingReview: 0, includedSceneCount: 0 }))).toEqual({ id: "reviewScenes", tab: "scenes" });
  });

  it("REAL 2026-09-14 DEFECT: an APPROVED plan with nothing executable points back at Scenes, never at a Preview button that cannot run", () => {
    // This is the exact shape that used to show "First Preview" as the
    // current step while the Preview tab said "No approved scene to
    // execute" - two screens disagreeing about the same project.
    const result = resolveNextAction(input({ planApproved: true, executableSceneCount: 0, scenesNeedingReview: 1 }));
    expect(result).toEqual({ id: "reviewScenes", tab: "scenes" });
  });

  it("distinguishes 'start the first preview' from 'approve the first preview' by the session's own parked state", () => {
    const base = input({ planApproved: true, executableSceneCount: 2 });
    expect(resolveNextAction(base)).toEqual({ id: "startFirstPreview", tab: "preview" });
    expect(resolveNextAction({ ...base, awaitingFirstPreviewApproval: true })).toEqual({ id: "approveFirstPreview", tab: "preview" });
  });

  it("asks for the remaining scenes to be built once the first preview is approved but execution is unfinished", () => {
    expect(resolveNextAction(input({ planApproved: true, executableSceneCount: 2, firstPreviewApproved: true }))).toEqual({
      id: "executeRemainingScenes",
      tab: "preview"
    });
  });

  it("THE STEP NOTHING USED TO POINT AT: sends a fully-executed project to Render Settings when no Landscape master is configured", () => {
    // Without this branch the guidance jumped straight to the complete
    // preview and then to an Export button that is permanently disabled
    // with "Not configured" - and in Simple Mode the tab that fixes it is
    // not even in the nav.
    const result = resolveNextAction(
      input({ planApproved: true, executableSceneCount: 2, firstPreviewApproved: true, allScenesComplete: true, landscapeRenderConfigured: false })
    );
    expect(result).toEqual({ id: "configureRenderOutput", tab: "renderSettings" });
  });

  it("only asks for the complete preview once the Landscape master really is configured", () => {
    const result = resolveNextAction(
      input({ planApproved: true, executableSceneCount: 2, firstPreviewApproved: true, allScenesComplete: true, landscapeRenderConfigured: true })
    );
    expect(result).toEqual({ id: "reviewFinalPreview", tab: "preview" });
  });

  it("only sends anyone to Export after the real fullPreviewApproved gate, and reports 'done' once an artifact exists", () => {
    expect(resolveNextAction(readyToRender())).toEqual({ id: "render", tab: "export" });
    expect(resolveNextAction(readyToRender({ hasRenderArtifact: true }))).toEqual({ id: "done", tab: null });
  });

  it("walks the whole workflow forward without ever repeating or skipping an action", () => {
    // Each step below flips exactly ONE real fact and must move the answer
    // on - a regression that made any branch unreachable (e.g. by testing
    // fullPreviewApproved before landscapeRenderConfigured) shows up here.
    const seen: string[] = [];
    let state = input({ hasPlan: false });
    const progressions: Array<Partial<NextActionInput>> = [
      { hasPlan: true, scenesNeedingReview: 1 },
      { scenesNeedingReview: 0 },
      { planApproved: true, executableSceneCount: 2 },
      { awaitingFirstPreviewApproval: true },
      { awaitingFirstPreviewApproval: false, firstPreviewApproved: true },
      { allScenesComplete: true },
      { landscapeRenderConfigured: true },
      { fullPreviewApproved: true },
      { hasRenderArtifact: true }
    ];
    seen.push(resolveNextAction(state).id);
    for (const progression of progressions) {
      state = { ...state, ...progression };
      seen.push(resolveNextAction(state).id);
    }
    expect(seen).toEqual([
      "createPlan",
      "reviewScenes",
      "approveScenes",
      "startFirstPreview",
      "approveFirstPreview",
      "executeRemainingScenes",
      "configureRenderOutput",
      "reviewFinalPreview",
      "render",
      "done"
    ]);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("resolveTabLocks", () => {
  it("locks Preview until the plan is approved AND something is really executable", () => {
    expect(resolveTabLocks(input({ hasPlan: true, planApproved: false, executableSceneCount: 0 })).preview).toBe(true);
    expect(resolveTabLocks(input({ hasPlan: true, planApproved: true, executableSceneCount: 0 })).preview).toBe(true);
    expect(resolveTabLocks(input({ hasPlan: true, planApproved: true, executableSceneCount: 1 })).preview).toBe(false);
  });

  it("locks Export on exactly the real fullPreviewApproved gate the server enforces - never on 'all scenes done'", () => {
    expect(resolveTabLocks(readyToRender({ fullPreviewApproved: false })).export).toBe(true);
    expect(resolveTabLocks(readyToRender({ fullPreviewApproved: true })).export).toBe(false);
  });
});
