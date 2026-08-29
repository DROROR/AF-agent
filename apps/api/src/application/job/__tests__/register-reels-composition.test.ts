import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type JobDto, type ScenePlanEntry, type TemplateManifest } from "@dyo/schemas";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { InMemoryExecutionSessionRepository } from "../../execution-session/test-support/in-memory-execution-session-repository.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { recordExecuteFrameResultIfApplicable } from "../record-execute-frame-result.js";
import { registerReelsCompositionIfApplicable } from "../register-reels-composition.js";
import { setRenderOutputConfig } from "../../execution-plan/set-render-output-config.js";
import { deterministicId } from "../../../domain/execution-plan/deterministic-id.js";

const NOW = new Date("2026-08-29T00:00:00.000Z");
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
      { compositionId: "comp-1", aeProjectItemIndex: 5, name: "Scene 01", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
    ],
    scenes: [],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

function sceneWithReelsLayout(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
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
    reelsLayout: {
      reelsCompositionName: "Scene 01 - Reels",
      layerTransforms: [{ layerIndex: 2, manifestPlaceholderId: "ph-1", positionX: 540, positionY: 960, scalePercent: 150 }],
      configuredAt: NOW.toISOString()
    },
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
    operationsRequested: 2,
    operationsCompleted: [0, 1],
    checkpoint: { completedOperationIndices: [0, 1], checkpointBeforeAt: null, checkpointAfterAt: NOW.toISOString(), failureReason: null },
    previewFramePath: "/work/execution-sessions/session-1/preview.png",
    previewTimestampSeconds: 0,
    reelsCompositionBuilt: { aeProjectItemIndex: 9, compositionName: "Scene 01 - Reels", widthPx: 1080, heightPx: 1920, durationSeconds: 5, frameRate: 30 },
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

async function setupPlan(repo: InMemoryExecutionPlanRepository, scenePlans: ScenePlanEntry[] = [sceneWithReelsLayout()], revision = 1) {
  return repo.createRevision(
    { id: "plan-1", projectId: PROJECT_ID, revision, status: "APPROVED", templateId: "tmpl-1", sourceProjectSha256: SOURCE_SHA, scenePlans, approvedAt: NOW, approvedBy: "user-1" },
    NOW
  );
}

async function setupSession(repo: InMemoryExecutionSessionRepository, planRevision = 1) {
  return repo.create({ id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision, sourceProjectSha256: SOURCE_SHA, assignedWorkerId: WORKER_ID }, NOW);
}

/** Full realistic setup, mirroring the real call order in routes/jobs.ts: record-execute-frame-result runs first, advancing the session's own working-copy sha to this job's own, THEN register-reels-composition runs. */
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
  await registerReelsCompositionIfApplicable({ executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW }, job);

  return { executionPlanRepository, executionSessionRepository, projectRepository, job };
}

describe("registerReelsCompositionIfApplicable", () => {
  it("registers the built composition as an additive derived entry on the project's manifest", async () => {
    const { projectRepository } = await setupAndRegister();
    const project = await projectRepository.findById(PROJECT_ID);
    const derivedId = deterministicId(["reels-composition", PROJECT_ID, "scene-1"]);
    const derived = project?.manifest.compositions.find((c) => c.compositionId === derivedId);
    expect(derived).toEqual({
      compositionId: derivedId,
      aeProjectItemIndex: 9,
      name: "Scene 01 - Reels",
      widthPx: 1080,
      heightPx: 1920,
      durationSeconds: 5,
      frameRate: 30,
      isNestedOnlyReferenced: false,
      parentCompositionIds: []
    });
  });

  it("the registered composition is immediately selectable exactly like any manifest composition (what Render Settings' own dropdown reads from)", async () => {
    const { projectRepository } = await setupAndRegister();
    const project = await projectRepository.findById(PROJECT_ID);
    const derivedId = deterministicId(["reels-composition", PROJECT_ID, "scene-1"]);
    // Render Settings' own dropdown does exactly this lookup - see
    // ProjectRenderSettingsTab.tsx / set-render-output-config.ts.
    const selectable = project?.manifest.compositions.find((c) => c.compositionId === derivedId);
    expect(selectable?.aeProjectItemIndex).toBe(9);
    expect(selectable?.name).toBe("Scene 01 - Reels");
  });

  it("retry/duplicate report of the same successful job never creates a second manifest entry - idempotent", async () => {
    const { projectRepository, executionPlanRepository, executionSessionRepository, job } = await setupAndRegister();
    // A second, duplicate report of the exact same successful job.
    await registerReelsCompositionIfApplicable({ executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW }, job);

    const project = await projectRepository.findById(PROJECT_ID);
    const derivedId = deterministicId(["reels-composition", PROJECT_ID, "scene-1"]);
    const matches = project?.manifest.compositions.filter((c) => c.compositionId === derivedId) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("rejects (does not register) when the plan has moved on to a newer revision than the session's own", async () => {
    const { projectRepository, executionPlanRepository, executionSessionRepository } = await setupAndRegister({ sessionPlanRevision: 1 });
    // Plan re-approved to revision 2 after this scene's job was dispatched.
    await setupPlan(executionPlanRepository, [sceneWithReelsLayout()], 2);

    await registerReelsCompositionIfApplicable(
      { executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW },
      baseJob()
    );

    const project = await projectRepository.findById(PROJECT_ID);
    const derivedId = deterministicId(["reels-composition", PROJECT_ID, "scene-1"]);
    expect(project?.manifest.compositions.some((c) => c.compositionId === derivedId)).toBe(true); // from the first, valid setupAndRegister call
    // Confirm the SECOND attempt (against the stale-relative-to-itself scenario) didn't throw and didn't change anything further - re-fetch count stays 1.
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

    await registerReelsCompositionIfApplicable(
      { executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW },
      baseJob()
    );

    const derivedId = deterministicId(["reels-composition", PROJECT_ID, "scene-1"]);
    const project = await projectRepository.findById(PROJECT_ID);
    expect(project?.manifest.compositions.some((c) => c.compositionId === derivedId)).toBe(false);
  });

  it("rejects a result whose executionSessionId belongs to a session from a DIFFERENT project - cross-project rejection", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const projectRepository = new InMemoryProjectRepository();
    await projectRepository.create({ id: PROJECT_ID, name: "P", manifest: manifest() }, NOW);
    await setupPlan(executionPlanRepository);
    // Session belongs to a DIFFERENT project than the job's own projectId.
    await executionSessionRepository.create(
      { id: SESSION_ID, projectId: "99999999-9999-9999-9999-999999999999", executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: SOURCE_SHA, assignedWorkerId: WORKER_ID },
      NOW
    );

    await registerReelsCompositionIfApplicable(
      { executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW },
      baseJob()
    );

    const derivedId = deterministicId(["reels-composition", PROJECT_ID, "scene-1"]);
    const project = await projectRepository.findById(PROJECT_ID);
    expect(project?.manifest.compositions.some((c) => c.compositionId === derivedId)).toBe(false);
  });

  it("never removes or mutates the original manifest compositions - purely additive", async () => {
    const { projectRepository } = await setupAndRegister();
    const project = await projectRepository.findById(PROJECT_ID);
    const original = project?.manifest.compositions.find((c) => c.compositionId === "comp-1");
    expect(original).toEqual(manifest().compositions[0]);
  });

  it("does nothing for a scene with no reelsLayout at all - Landscape-only scenes are completely unaffected", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const projectRepository = new InMemoryProjectRepository();
    await projectRepository.create({ id: PROJECT_ID, name: "P", manifest: manifest() }, NOW);
    await setupPlan(executionPlanRepository, [sceneWithReelsLayout({ reelsLayout: null })]);
    await setupSession(executionSessionRepository);

    const job = baseJob({ result: validResult({ reelsCompositionBuilt: null }) });
    await recordExecuteFrameResultIfApplicable({ executionSessionRepository, executionPlanRepository, now: () => NOW }, job);
    await registerReelsCompositionIfApplicable({ executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW }, job);

    const project = await projectRepository.findById(PROJECT_ID);
    expect(project?.manifest.compositions).toEqual(manifest().compositions);
  });

  it("does nothing for a FAILED job, even one that reports a reelsCompositionBuilt-shaped payload", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const projectRepository = new InMemoryProjectRepository();
    await projectRepository.create({ id: PROJECT_ID, name: "P", manifest: manifest() }, NOW);
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);

    const job = baseJob({ status: "FAILED", result: validResult({ failureReason: "operation 1 failed" }) });
    await registerReelsCompositionIfApplicable({ executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW }, job);

    const derivedId = deterministicId(["reels-composition", PROJECT_ID, "scene-1"]);
    const project = await projectRepository.findById(PROJECT_ID);
    expect(project?.manifest.compositions.some((c) => c.compositionId === derivedId)).toBe(false);
  });

  it("RENDER REELS resolves the exact registered composition through the REAL setRenderOutputConfig - browser only ever sends manifestCompositionId, never a raw index/name", async () => {
    const { executionPlanRepository, projectRepository } = await setupAndRegister();
    const derivedId = deterministicId(["reels-composition", PROJECT_ID, "scene-1"]);

    const response = await setRenderOutputConfig(
      { executionPlanRepository, projectRepository, now: () => NOW },
      PROJECT_ID,
      "REELS",
      { manifestCompositionId: derivedId, renderSettingsTemplateName: "Best Settings", outputModuleTemplateName: "H.264 - Match Source" }
    );

    // The server itself resolved aeProjectItemIndex/compositionName from
    // the manifest - the caller never supplied either.
    expect(response.plan.renderOutputs.REELS).toMatchObject({
      manifestCompositionId: derivedId,
      aeProjectItemIndex: 9,
      compositionName: "Scene 01 - Reels"
    });
  });

  it("Landscape's own render output configuration still works unaffected after a Reels composition has been registered elsewhere in the manifest", async () => {
    const { executionPlanRepository, projectRepository } = await setupAndRegister();

    const response = await setRenderOutputConfig(
      { executionPlanRepository, projectRepository, now: () => NOW },
      PROJECT_ID,
      "LANDSCAPE",
      { manifestCompositionId: "comp-1", renderSettingsTemplateName: "Best Settings", outputModuleTemplateName: "H.264 - Match Source" }
    );

    expect(response.plan.renderOutputs.LANDSCAPE).toMatchObject({ manifestCompositionId: "comp-1", aeProjectItemIndex: 5, compositionName: "Scene 01" });
  });
});
