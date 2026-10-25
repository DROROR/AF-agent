import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type JobDto, type ScenePlanEntry, type TemplateManifest } from "@dyo/schemas";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { InMemoryExecutionSessionRepository } from "../../execution-session/test-support/in-memory-execution-session-repository.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { recordExecuteFrameResultIfApplicable } from "../record-execute-frame-result.js";
import { registerVerticalCompositionIfApplicable } from "../register-vertical-composition.js";
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
    verticalCompositionBuilt: { aeProjectItemIndex: 62, compositionName: "!Render (Vertical)", widthPx: 1080, heightPx: 1920, durationSeconds: 45, frameRate: 29.97 },
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

/** Mirrors routes/jobs.ts: record-execute-frame-result first, then register-square-composition. `landscape` configures the LANDSCAPE output beforehand, the way a client who made the Landscape video has. */
async function setupAndRegister(overrides: {
  scenePlans?: ScenePlanEntry[];
  planRevision?: number;
  sessionPlanRevision?: number;
  job?: Partial<JobDto>;
  landscape?: boolean;
} = {}) {
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const executionSessionRepository = new InMemoryExecutionSessionRepository();
  const projectRepository = new InMemoryProjectRepository();
  await projectRepository.create({ id: PROJECT_ID, name: "P", manifest: manifest() }, NOW);
  await setupPlan(executionPlanRepository, overrides.scenePlans, overrides.planRevision ?? 1);
  await setupSession(executionSessionRepository, overrides.sessionPlanRevision ?? 1);
  if (overrides.landscape !== false) {
    await setRenderOutputConfig({ executionPlanRepository, projectRepository, now: () => NOW }, PROJECT_ID, "LANDSCAPE", {
      manifestCompositionId: "comp-210",
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps"
    });
  }

  const job = baseJob(overrides.job);
  await recordExecuteFrameResultIfApplicable({ executionSessionRepository, executionPlanRepository, now: () => NOW }, job);
  await registerVerticalCompositionIfApplicable({ executionSessionRepository, executionPlanRepository, projectRepository, now: () => NOW }, job);

  return { executionPlanRepository, executionSessionRepository, projectRepository, job };
}

describe("registerVerticalCompositionIfApplicable (2026-10-25, the client's Reels version)", () => {
  it("registers the built Square composition on the manifest AND configures the REELS output from it with the Landscape's own template names", async () => {
    const { projectRepository, executionPlanRepository } = await setupAndRegister();
    const derivedId = deterministicId(["vertical-composition", PROJECT_ID, "scene-1"]);
    const project = await projectRepository.findById(PROJECT_ID);
    expect(project?.manifest.compositions.find((c) => c.compositionId === derivedId)).toEqual({
      compositionId: derivedId,
      aeProjectItemIndex: 62,
      name: "!Render (Vertical)",
      widthPx: 1080,
      heightPx: 1920,
      durationSeconds: 45,
      frameRate: 29.97,
      isNestedOnlyReferenced: false,
      parentCompositionIds: []
    });
    const plan = await executionPlanRepository.findCurrentByProjectId(PROJECT_ID);
    expect(plan?.renderOutputs.REELS).toMatchObject({
      manifestCompositionId: derivedId,
      aeProjectItemIndex: 62,
      compositionName: "!Render (Vertical)",
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps"
    });
    // The Landscape's own configuration is untouched.
    expect(plan?.renderOutputs.LANDSCAPE?.manifestCompositionId).toBe("comp-210");
  });

  it("registers the composition but leaves REELS unconfigured when no Landscape output exists - nothing is guessed", async () => {
    const { projectRepository, executionPlanRepository } = await setupAndRegister({ landscape: false });
    const derivedId = deterministicId(["vertical-composition", PROJECT_ID, "scene-1"]);
    expect((await projectRepository.findById(PROJECT_ID))?.manifest.compositions.some((c) => c.compositionId === derivedId)).toBe(true);
    expect((await executionPlanRepository.findCurrentByProjectId(PROJECT_ID))?.renderOutputs.REELS).toBeNull();
  });

  it("uses a DISTINCT id namespace from the Landscape and Reels derived entries", () => {
    const ids = new Set([
      deterministicId(["reels-composition", PROJECT_ID, "scene-1"]),
      deterministicId(["horizontal-composition", PROJECT_ID, "scene-1"]),
      deterministicId(["vertical-composition", PROJECT_ID, "scene-1"])
    ]);
    expect(ids.size).toBe(3);
  });

  it("does nothing for a job whose result carries no verticalCompositionBuilt (an ordinary frame)", async () => {
    const { projectRepository, executionPlanRepository } = await setupAndRegister({ job: { result: validResult({ verticalCompositionBuilt: null }) } });
    const derivedId = deterministicId(["vertical-composition", PROJECT_ID, "scene-1"]);
    expect((await projectRepository.findById(PROJECT_ID))?.manifest.compositions.some((c) => c.compositionId === derivedId)).toBe(false);
    expect((await executionPlanRepository.findCurrentByProjectId(PROJECT_ID))?.renderOutputs.REELS).toBeNull();
  });
});
