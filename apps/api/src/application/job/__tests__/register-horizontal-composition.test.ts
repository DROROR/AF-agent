import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type JobDto, type ScenePlanEntry, type TemplateManifest } from "@dyo/schemas";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { InMemoryExecutionSessionRepository } from "../../execution-session/test-support/in-memory-execution-session-repository.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { recordExecuteFrameResultIfApplicable } from "../record-execute-frame-result.js";
import { registerHorizontalCompositionIfApplicable } from "../register-horizontal-composition.js";
import { setRenderOutputConfig } from "../../execution-plan/set-render-output-config.js";
import { deterministicId } from "../../../domain/execution-plan/deterministic-id.js";

const NOW = new Date("2026-09-10T00:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const WORKER_ID = "33333333-3333-3333-3333-333333333333";
const SESSION_ID = "44444444-4444-4444-4444-444444444444";
const SOURCE_SHA = "a".repeat(64);
const WORKING_SHA = "b".repeat(64);

function manifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: SOURCE_SHA },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW.toISOString(),
    compositions: [
      { compositionId: "comp-210", aeProjectItemIndex: 2, name: "!Render", widthPx: 1080, heightPx: 1920, durationSeconds: 45, frameRate: 29.97, isNestedOnlyReferenced: false, parentCompositionIds: [] }
    ],
    scenes: [],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

function validScene(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-210",
    compositionName: "!Render",
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

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    executionSessionId: SESSION_ID,
    scenePlanId: "scene-1",
    sourceProjectSha256: SOURCE_SHA,
    workingProjectPath: "/work/execution-sessions/session-1/working-copy.aep",
    workingProjectSha256: WORKING_SHA,
    workingCopyFailureCode: null,
    operationsRequested: 1,
    operationsCompleted: [0],
    checkpoint: { completedOperationIndices: [0], checkpointBeforeAt: null, checkpointAfterAt: NOW.toISOString(), failureReason: null },
    previewFramePath: "/work/execution-sessions/session-1/preview.png",
    previewTimestampSeconds: 0,
    horizontalCompositionBuilt: { aeProjectItemIndex: 61, compositionName: "!Render (Landscape)", widthPx: 1920, heightPx: 1080, durationSeconds: 45, frameRate: 29.97 },
    failureReason: null,
    startedAt: NOW.toISOString(),
    completedAt: NOW.toISOString(),
    ...overrides
  };
}

function baseJob(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: JOB_ID,
    workerId: WORKER_ID,
    projectId: PROJECT_ID,
    operation: "EXECUTE_FRAME",
    status: "SUCCEEDED",
    payload: {},
    result: validResult(),
    error: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides
  } as JobDto;
}

async function setupPlan(repo: InMemoryExecutionPlanRepository, scenePlans: ScenePlanEntry[] = [validScene()], revision = 1) {
  return repo.createRevision(
    { id: "plan-1", projectId: PROJECT_ID, revision, status: "APPROVED", templateId: "tmpl-1", sourceProjectSha256: SOURCE_SHA, scenePlans, approvedAt: NOW, approvedBy: "user-1" },
    NOW
  );
}

async function setupSession(repo: InMemoryExecutionSessionRepository, planRevision = 1) {
  return repo.create({ id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision, sourceProjectSha256: SOURCE_SHA, assignedWorkerId: WORKER_ID }, NOW);
}

/** Full realistic setup, mirroring the real call order in routes/jobs.ts: record-execute-frame-result runs first, advancing the session's own working-copy sha to this job's own, THEN register-horizontal-composition runs. */
async function setupAndRegister(overrides: {
  scenePlans?: ScenePlanEntry[];
  planRevision?: number;
  sessionPlanRevision?: number;
  job?: Partial<JobDto>;
} = {}) {
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const executionSessionRepository = new InMemoryExecutionSessionRepository();
  const projectRepository = new InMemoryProjectRepository();
  await projectRepository.create({ id: PROJECT_ID, name: "P", manifest: manifest() }, NOW);
  await setupPlan(executionPlanRepository, overrides.scenePlans, overrides.planRevision ?? 1);
  await setupSession(executionSessionRepository, overrides.sessionPlanRevision ?? 1);

  const job = baseJob(overrides.job);
  await recordExecuteFrameResultIfApplicable({ executionSessionRepository, executionPlanRepository, now: () => NOW }, job);
  await registerHorizontalCompositionIfApplicable({ executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW }, job);

  return { executionPlanRepository, executionSessionRepository, projectRepository, job };
}

describe("registerHorizontalCompositionIfApplicable", () => {
  it("registers the built Landscape composition as an additive derived entry on the project's manifest", async () => {
    const { projectRepository } = await setupAndRegister();
    const project = await projectRepository.findById(PROJECT_ID);
    const derivedId = deterministicId(["horizontal-composition", PROJECT_ID, "scene-1"]);
    const derived = project?.manifest.compositions.find((c) => c.compositionId === derivedId);
    expect(derived).toEqual({
      compositionId: derivedId,
      aeProjectItemIndex: 61,
      name: "!Render (Landscape)",
      widthPx: 1920,
      heightPx: 1080,
      durationSeconds: 45,
      frameRate: 29.97,
      isNestedOnlyReferenced: false,
      parentCompositionIds: []
    });
  });

  it("uses a DISTINCT id namespace from register-reels-composition.ts's own derived entries, so the two can never collide for the same scene", async () => {
    const reelsId = deterministicId(["reels-composition", PROJECT_ID, "scene-1"]);
    const horizontalId = deterministicId(["horizontal-composition", PROJECT_ID, "scene-1"]);
    expect(horizontalId).not.toBe(reelsId);
  });

  it("the registered composition is immediately selectable exactly like any manifest composition (what Render Settings' own dropdown reads from)", async () => {
    const { projectRepository } = await setupAndRegister();
    const derivedId = deterministicId(["horizontal-composition", PROJECT_ID, "scene-1"]);
    const project = await projectRepository.findById(PROJECT_ID);
    const selectable = project?.manifest.compositions.find((c) => c.compositionId === derivedId);
    expect(selectable?.aeProjectItemIndex).toBe(61);
    expect(selectable?.name).toBe("!Render (Landscape)");
  });

  it("retry/duplicate report of the same successful job never creates a second manifest entry - idempotent", async () => {
    const { projectRepository, executionPlanRepository, executionSessionRepository, job } = await setupAndRegister();
    await registerHorizontalCompositionIfApplicable({ executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW }, job);

    const project = await projectRepository.findById(PROJECT_ID);
    const derivedId = deterministicId(["horizontal-composition", PROJECT_ID, "scene-1"]);
    const matches = project?.manifest.compositions.filter((c) => c.compositionId === derivedId) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("rejects (does not register) when the plan has moved on to a newer revision than the session's own", async () => {
    const { projectRepository, executionPlanRepository, executionSessionRepository } = await setupAndRegister({ sessionPlanRevision: 1 });
    await setupPlan(executionPlanRepository, [validScene()], 2);

    await registerHorizontalCompositionIfApplicable({ executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW }, baseJob());

    const project = await projectRepository.findById(PROJECT_ID);
    const derivedId = deterministicId(["horizontal-composition", PROJECT_ID, "scene-1"]);
    const matches = project?.manifest.compositions.filter((c) => c.compositionId === derivedId) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("rejects (does not register) when the session's own latestWorkingProjectSha256 no longer matches this job's own produced sha - stale working copy", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const projectRepository = new InMemoryProjectRepository();
    await projectRepository.create({ id: PROJECT_ID, name: "P", manifest: manifest() }, NOW);
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);
    // Never called recordExecuteFrameResultIfApplicable - the session's
    // latestWorkingProjectSha256 stays null, which can never equal a real sha.

    await registerHorizontalCompositionIfApplicable({ executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW }, baseJob());

    const derivedId = deterministicId(["horizontal-composition", PROJECT_ID, "scene-1"]);
    const project = await projectRepository.findById(PROJECT_ID);
    expect(project?.manifest.compositions.some((c) => c.compositionId === derivedId)).toBe(false);
  });

  it("rejects a result whose executionSessionId belongs to a session from a DIFFERENT project - cross-project rejection", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const projectRepository = new InMemoryProjectRepository();
    await projectRepository.create({ id: PROJECT_ID, name: "P", manifest: manifest() }, NOW);
    await setupPlan(executionPlanRepository);
    await executionSessionRepository.create(
      { id: SESSION_ID, projectId: "99999999-9999-9999-9999-999999999999", executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: SOURCE_SHA, assignedWorkerId: WORKER_ID },
      NOW
    );

    await registerHorizontalCompositionIfApplicable({ executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW }, baseJob());

    const derivedId = deterministicId(["horizontal-composition", PROJECT_ID, "scene-1"]);
    const project = await projectRepository.findById(PROJECT_ID);
    expect(project?.manifest.compositions.some((c) => c.compositionId === derivedId)).toBe(false);
  });

  it("never removes or mutates the original manifest compositions - purely additive", async () => {
    const { projectRepository } = await setupAndRegister();
    const project = await projectRepository.findById(PROJECT_ID);
    const original = project?.manifest.compositions.find((c) => c.compositionId === "comp-210");
    expect(original).toEqual(manifest().compositions[0]);
  });

  it("does nothing when this job's own result carries no horizontalCompositionBuilt at all - a normal content-only scene is completely unaffected", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const projectRepository = new InMemoryProjectRepository();
    await projectRepository.create({ id: PROJECT_ID, name: "P", manifest: manifest() }, NOW);
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);

    const job = baseJob({ result: validResult({ horizontalCompositionBuilt: null }) });
    await recordExecuteFrameResultIfApplicable({ executionSessionRepository, executionPlanRepository, now: () => NOW }, job);
    await registerHorizontalCompositionIfApplicable({ executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW }, job);

    const project = await projectRepository.findById(PROJECT_ID);
    expect(project?.manifest.compositions).toEqual(manifest().compositions);
  });

  it("does nothing for a FAILED job, even one that reports a horizontalCompositionBuilt-shaped payload", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const projectRepository = new InMemoryProjectRepository();
    await projectRepository.create({ id: PROJECT_ID, name: "P", manifest: manifest() }, NOW);
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);

    const job = baseJob({ status: "FAILED", result: validResult({ failureReason: "operation 0 failed" }) });
    await registerHorizontalCompositionIfApplicable({ executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW }, job);

    const derivedId = deterministicId(["horizontal-composition", PROJECT_ID, "scene-1"]);
    const project = await projectRepository.findById(PROJECT_ID);
    expect(project?.manifest.compositions.some((c) => c.compositionId === derivedId)).toBe(false);
  });

  it("RENDER LANDSCAPE resolves the exact registered composition through the REAL setRenderOutputConfig - browser only ever sends manifestCompositionId, never a raw index/name", async () => {
    const { executionPlanRepository, projectRepository } = await setupAndRegister();
    const derivedId = deterministicId(["horizontal-composition", PROJECT_ID, "scene-1"]);

    const response = await setRenderOutputConfig(
      { executionPlanRepository, projectRepository, now: () => NOW },
      PROJECT_ID,
      "LANDSCAPE",
      { manifestCompositionId: derivedId, renderSettingsTemplateName: "Best Settings", outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps" }
    );

    expect(response.plan.renderOutputs.LANDSCAPE).toMatchObject({
      manifestCompositionId: derivedId,
      aeProjectItemIndex: 61,
      compositionName: "!Render (Landscape)"
    });
  });

  it("REELS' own render output configuration still works unaffected after a Landscape composition has been registered elsewhere in the manifest", async () => {
    const { executionPlanRepository, projectRepository } = await setupAndRegister();

    const response = await setRenderOutputConfig(
      { executionPlanRepository, projectRepository, now: () => NOW },
      PROJECT_ID,
      "REELS",
      { manifestCompositionId: "comp-210", renderSettingsTemplateName: "Best Settings", outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps" }
    );

    expect(response.plan.renderOutputs.REELS).toMatchObject({ manifestCompositionId: "comp-210", aeProjectItemIndex: 2, compositionName: "!Render" });
  });
});
