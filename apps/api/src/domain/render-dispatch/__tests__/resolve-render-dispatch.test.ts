import { describe, expect, it } from "vitest";
import type { RenderOutputConfig } from "@dyo/schemas";
import { resolveRenderDispatch, type RenderDispatchPlanSnapshot } from "../resolve-render-dispatch.js";
import type { SceneEditWorkerSnapshot } from "../../execute-scene-edit/validate-scene-edit-preconditions.js";

const SHA = "a".repeat(64);
const NOW = new Date("2026-01-01T00:00:00.000Z");
const STALE_AFTER_MS = 30_000;
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const SOURCE_PATH = "C:\\vidio agent\\White App Promo (converted).aep";

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

function validPlan(overrides: Partial<RenderDispatchPlanSnapshot> = {}): RenderDispatchPlanSnapshot {
  return {
    id: "plan-1",
    revision: 2,
    status: "APPROVED",
    sourceProjectSha256: SHA,
    renderOutputs: { LANDSCAPE: validConfig(), REELS: null },
    workingProjectPath: "/work/jobs/job-1/working-copy.aep",
    workingProjectSha256: "d".repeat(64),
    ...overrides
  };
}

function validWorker(overrides: Partial<SceneEditWorkerSnapshot> = {}): SceneEditWorkerSnapshot {
  return {
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
  it("succeeds and returns the full worker payload, built from the persisted config + the plan's own working-copy identity", () => {
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
      workingProjectPath: "/work/jobs/job-1/working-copy.aep",
      workingProjectSha256: "d".repeat(64),
      aeProjectItemIndex: 5,
      compositionName: "Landscape Master",
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Source"
    });
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

  it("fails closed when no working copy has ever been produced for this plan yet", () => {
    const result = resolveRenderDispatch(baseInput({ currentPlan: validPlan({ workingProjectPath: null, workingProjectSha256: null }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("No working copy has been produced");
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

  it("never accepts an aeProjectItemIndex/compositionName/workingProjectPath from the caller - the resolved payload always comes from persisted state, not the input", () => {
    const result = resolveRenderDispatch(baseInput());
    expect(result.ok).toBe(true);
    // The function's own input type has no field through which a caller
    // could smuggle an addressing/path value - proven structurally: only
    // `variant` selects WHICH persisted config is used, and
    // workingProjectPath/Sha256 always come from the plan snapshot.
    if (!result.ok) return;
    expect(result.payload.aeProjectItemIndex).toBe(5);
    expect(result.payload.workingProjectPath).toBe("/work/jobs/job-1/working-copy.aep");
  });
});
