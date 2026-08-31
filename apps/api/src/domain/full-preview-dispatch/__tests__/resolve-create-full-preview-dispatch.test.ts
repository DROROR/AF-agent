import { describe, expect, it } from "vitest";
import type { RenderOutputConfig, ScenePlanEntry } from "@dyo/schemas";
import {
  resolveCreateFullPreviewDispatch,
  type FullPreviewDispatchPlanSnapshot,
  type FullPreviewDispatchSessionSnapshot
} from "../resolve-create-full-preview-dispatch.js";
import type { SceneEditWorkerSnapshot } from "../../execute-scene-edit/validate-scene-edit-preconditions.js";

const SHA = "a".repeat(64);
const NOW = new Date("2026-01-01T00:00:00.000Z");
const STALE_AFTER_MS = 30_000;
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const SOURCE_PATH = "C:\\vidio agent\\White App Promo (converted).aep";
const WORKER_ID = "44444444-4444-4444-4444-444444444444";
const SESSION_ID = "55555555-5555-5555-5555-555555555555";
const WORKING_SHA = "d".repeat(64);

function validConfig(overrides: Partial<RenderOutputConfig> = {}): RenderOutputConfig {
  return {
    manifestCompositionId: "comp-1",
    aeProjectItemIndex: 5,
    compositionName: "Landscape Master",
    sourceProjectSha256: SHA,
    renderSettingsTemplateName: "Best Settings",
    outputModuleTemplateName: "H.264 - Match Source",
    configuredAt: NOW.toISOString(),
    ...overrides
  };
}

function validScene(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene 01",
    use: true,
    sourcePosition: 0,
    finalOrder: 0,
    finalDuration: null,
    approvalState: "APPROVED",
    instructions: null,
    notes: null,
    unresolvedReasons: [],
    evidence: [],
    mappings: [],
    reelsLayout: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides
  };
}

function validPlan(overrides: Partial<FullPreviewDispatchPlanSnapshot> = {}): FullPreviewDispatchPlanSnapshot {
  return {
    id: "plan-1",
    revision: 2,
    status: "APPROVED",
    sourceProjectSha256: SHA,
    renderOutputs: { LANDSCAPE: validConfig(), REELS: null },
    scenePlans: [validScene()],
    ...overrides
  };
}

function validSession(overrides: Partial<FullPreviewDispatchSessionSnapshot> = {}): FullPreviewDispatchSessionSnapshot {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    planRevision: 2,
    sourceProjectSha256: SHA,
    assignedWorkerId: WORKER_ID,
    status: "READY_TO_RENDER",
    latestWorkingProjectSha256: WORKING_SHA,
    completedScenePlanIds: ["scene-1"],
    firstPreviewApproved: true,
    ...overrides
  };
}

function validWorker(overrides: Partial<SceneEditWorkerSnapshot> = {}): SceneEditWorkerSnapshot {
  return {
    id: WORKER_ID,
    status: "ONLINE",
    aeStatus: "ONLINE",
    mcpStatus: "ONLINE",
    capabilities: ["CREATE_PREVIEW"],
    currentJobId: null,
    lastHeartbeatAt: NOW,
    ...overrides
  };
}

function baseInput(overrides: Partial<Parameters<typeof resolveCreateFullPreviewDispatch>[0]> = {}) {
  return {
    projectId: PROJECT_ID,
    session: validSession(),
    currentPlan: validPlan(),
    currentProjectSourceProjectSha256: SHA,
    currentProjectSourceProjectPath: SOURCE_PATH,
    worker: validWorker(),
    now: NOW,
    staleAfterMs: STALE_AFTER_MS,
    ...overrides
  };
}

describe("resolveCreateFullPreviewDispatch", () => {
  it("succeeds and reuses the project's own configured LANDSCAPE composition/templates - never a second, invented 'preview composition'", () => {
    const result = resolveCreateFullPreviewDispatch(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      projectId: PROJECT_ID,
      executionSessionId: SESSION_ID,
      sourceProjectPath: SOURCE_PATH,
      expectedWorkingProjectSha256: WORKING_SHA,
      aeProjectItemIndex: 5,
      compositionName: "Landscape Master",
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Source"
    });
  });

  it("fails when no execution session exists", () => {
    const result = resolveCreateFullPreviewDispatch(baseInput({ session: null }));
    expect(result.ok).toBe(false);
  });

  it("fails when the plan is not APPROVED", () => {
    const result = resolveCreateFullPreviewDispatch(baseInput({ currentPlan: validPlan({ status: "DRAFT" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not APPROVED");
  });

  it("fails when LANDSCAPE output is not configured yet - reused, not invented, so this is a real prerequisite", () => {
    const result = resolveCreateFullPreviewDispatch(baseInput({ currentPlan: validPlan({ renderOutputs: { LANDSCAPE: null, REELS: null } }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Landscape output is not configured");
  });

  it("fails when no scene edit has completed yet", () => {
    const result = resolveCreateFullPreviewDispatch(baseInput({ session: validSession({ latestWorkingProjectSha256: null, completedScenePlanIds: [] }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("No scene edit has completed");
  });

  it("fails when the first-frame preview has not been approved yet - required BEFORE a complete preview can be created", () => {
    const result = resolveCreateFullPreviewDispatch(baseInput({ session: validSession({ firstPreviewApproved: false }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("first-frame preview");
  });

  it("fails when not every approved scene has completed yet - the complete preview must reflect the WHOLE video", () => {
    const result = resolveCreateFullPreviewDispatch(
      baseInput({
        currentPlan: validPlan({ scenePlans: [validScene({ id: "scene-1" }), validScene({ id: "scene-2" })] }),
        session: validSession({ completedScenePlanIds: ["scene-1"] })
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not ready to create the complete preview");
  });

  it("fails when the worker does not report the CREATE_PREVIEW capability", () => {
    const result = resolveCreateFullPreviewDispatch(baseInput({ worker: validWorker({ capabilities: ["RENDER"] }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("CREATE_PREVIEW");
  });

  it("fails when the dispatched worker is not this session's own assignedWorkerId - worker affinity", () => {
    const result = resolveCreateFullPreviewDispatch(baseInput({ session: validSession({ assignedWorkerId: "99999999-9999-9999-9999-999999999999" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("pinned to a different worker");
  });
});
