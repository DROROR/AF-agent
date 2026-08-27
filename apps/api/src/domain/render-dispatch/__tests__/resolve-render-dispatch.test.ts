import { describe, expect, it } from "vitest";
import type { RenderOutputConfig, ScenePlanEntry } from "@dyo/schemas";
import { resolveRenderDispatch, type RenderDispatchPlanSnapshot, type RenderDispatchSessionSnapshot } from "../resolve-render-dispatch.js";
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
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides
  };
}

function validPlan(overrides: Partial<RenderDispatchPlanSnapshot> = {}): RenderDispatchPlanSnapshot {
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

function validSession(overrides: Partial<RenderDispatchSessionSnapshot> = {}): RenderDispatchSessionSnapshot {
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
    capabilities: ["RENDER"],
    currentJobId: null,
    lastHeartbeatAt: NOW,
    ...overrides
  };
}

function baseInput(overrides: Partial<Parameters<typeof resolveRenderDispatch>[0]> = {}) {
  return {
    projectId: PROJECT_ID,
    variant: "LANDSCAPE" as const,
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

describe("resolveRenderDispatch", () => {
  it("succeeds and returns the full worker payload, built from the persisted config + the session's own working-copy identity", () => {
    const result = resolveRenderDispatch(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      projectId: PROJECT_ID,
      planId: "plan-1",
      planRevision: 2,
      variant: "LANDSCAPE",
      sourceProjectPath: SOURCE_PATH,
      sourceProjectSha256: SHA,
      executionSessionId: SESSION_ID,
      expectedWorkingProjectSha256: WORKING_SHA,
      aeProjectItemIndex: 5,
      compositionName: "Landscape Master",
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Source"
    });
  });

  it("resolves REELS from the SAME session as LANDSCAPE - both variants render from one cumulative working copy, never a fallback to the original source", () => {
    const reelsConfig = validConfig({ manifestCompositionId: "comp-2", aeProjectItemIndex: 6, compositionName: "Reels Master" });
    const result = resolveRenderDispatch(
      baseInput({
        variant: "REELS",
        currentPlan: validPlan({ renderOutputs: { LANDSCAPE: validConfig(), REELS: reelsConfig } })
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.executionSessionId).toBe(SESSION_ID);
    expect(result.payload.expectedWorkingProjectSha256).toBe(WORKING_SHA);
    expect(result.payload.compositionName).toBe("Reels Master");
  });

  it("fails when no execution session exists for the requested executionSessionId", () => {
    const result = resolveRenderDispatch(baseInput({ session: null }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("No execution session was found");
  });

  it("fails when the session belongs to a different project", () => {
    const result = resolveRenderDispatch(baseInput({ session: validSession({ projectId: "99999999-9999-9999-9999-999999999999" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("does not belong to this project");
  });

  it("fails when the session is already terminal (COMPLETED/FAILED) - a new execution session is required", () => {
    for (const status of ["COMPLETED", "FAILED"] as const) {
      const result = resolveRenderDispatch(baseInput({ session: validSession({ status }) }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("start a new execution session");
    }
  });

  it("fails when no plan exists", () => {
    const result = resolveRenderDispatch(baseInput({ currentPlan: null }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("No execution plan exists");
  });

  it("fails when the plan is not APPROVED", () => {
    const result = resolveRenderDispatch(baseInput({ currentPlan: validPlan({ status: "DRAFT" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not APPROVED");
  });

  it("fails when the session's own bound planRevision no longer matches the current plan", () => {
    const result = resolveRenderDispatch(baseInput({ session: validSession({ planRevision: 1 }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("start a new execution session");
  });

  it("fails when the session's own bound sourceProjectSha256 no longer matches the current plan", () => {
    const result = resolveRenderDispatch(baseInput({ session: validSession({ sourceProjectSha256: "c".repeat(64) }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("start a new execution session");
  });

  it("fails when the project's current manifest sha256 no longer matches the plan's own", () => {
    const result = resolveRenderDispatch(baseInput({ currentProjectSourceProjectSha256: "b".repeat(64) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no longer matches");
  });

  it("fails when the requested variant has no configured output at all", () => {
    const result = resolveRenderDispatch(baseInput({ variant: "REELS" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("is not configured");
  });

  it("fails closed when the configured output is STALE (bound to a different source sha than the plan's current one)", () => {
    const staleConfig = validConfig({ sourceProjectSha256: "c".repeat(64) });
    const result = resolveRenderDispatch(
      baseInput({ currentPlan: validPlan({ renderOutputs: { LANDSCAPE: staleConfig, REELS: null } }) })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("stale");
  });

  it("fails closed when no scene edit has ever completed in this execution session yet", () => {
    const result = resolveRenderDispatch(baseInput({ session: validSession({ latestWorkingProjectSha256: null, completedScenePlanIds: [] }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("No scene edit has completed");
  });

  it("fails closed when the first-frame preview has not been approved yet", () => {
    const result = resolveRenderDispatch(baseInput({ session: validSession({ firstPreviewApproved: false }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("preview");
  });

  it("fails closed when not every approved scene has completed in this session yet - never a partial render", () => {
    const result = resolveRenderDispatch(
      baseInput({
        currentPlan: validPlan({ scenePlans: [validScene({ id: "scene-1" }), validScene({ id: "scene-2" })] }),
        session: validSession({ completedScenePlanIds: ["scene-1"] })
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not ready to render");
  });

  it("ignores excluded (use=false) and unapproved scenes when computing the required set - only approved, resolved, in-use scenes gate readiness", () => {
    const result = resolveRenderDispatch(
      baseInput({
        currentPlan: validPlan({
          scenePlans: [
            validScene({ id: "scene-1" }),
            validScene({ id: "scene-2", use: false }),
            validScene({ id: "scene-3", approvalState: "UNREVIEWED" })
          ]
        }),
        session: validSession({ completedScenePlanIds: ["scene-1"] })
      })
    );
    expect(result.ok).toBe(true);
  });

  it("fails when the worker has never reported in", () => {
    const result = resolveRenderDispatch(baseInput({ worker: null }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("never reported in");
  });

  it("fails when the worker's heartbeat is stale", () => {
    const result = resolveRenderDispatch(
      baseInput({ worker: validWorker({ lastHeartbeatAt: new Date(NOW.getTime() - 60_000) }) })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("ONLINE");
  });

  it("fails when AE is not ONLINE", () => {
    const result = resolveRenderDispatch(baseInput({ worker: validWorker({ aeStatus: "OFFLINE" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("AE is not ONLINE");
  });

  it("fails when MCP is not ONLINE", () => {
    const result = resolveRenderDispatch(baseInput({ worker: validWorker({ mcpStatus: "OFFLINE" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("MCP is not ONLINE");
  });

  it("fails when the worker does not report the RENDER capability", () => {
    const result = resolveRenderDispatch(baseInput({ worker: validWorker({ capabilities: [] }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("RENDER");
  });

  it("fails when the worker already has a job in progress", () => {
    const result = resolveRenderDispatch(baseInput({ worker: validWorker({ currentJobId: "job-1" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("already has a job in progress");
  });

  it("fails when the dispatched worker is not the session's own assignedWorkerId - worker affinity", () => {
    const result = resolveRenderDispatch(baseInput({ worker: validWorker({ id: "66666666-6666-6666-6666-666666666666" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("pinned to a different worker");
  });

  it("never accepts an aeProjectItemIndex/compositionName/workingProjectPath from the caller - the resolved payload always comes from persisted state, not the input", () => {
    const result = resolveRenderDispatch(baseInput());
    expect(result.ok).toBe(true);
    // The function's own input type has no field through which a caller
    // could smuggle an addressing/path value - proven structurally: only
    // `variant` selects WHICH persisted config is used, and the working
    // copy is always identified by executionSessionId, never a raw path.
    if (!result.ok) return;
    expect(result.payload.aeProjectItemIndex).toBe(5);
    expect(result.payload).not.toHaveProperty("workingProjectPath");
    expect(result.payload.executionSessionId).toBe(SESSION_ID);
  });
});
