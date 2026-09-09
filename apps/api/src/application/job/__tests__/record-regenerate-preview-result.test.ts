import { describe, expect, it } from "vitest";
import type { JobDto } from "@dyo/schemas";
import { InMemoryExecutionSessionRepository } from "../../execution-session/test-support/in-memory-execution-session-repository.js";
import { recordRegeneratePreviewResultIfApplicable } from "../record-regenerate-preview-result.js";

const NOW = new Date("2026-09-09T00:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const WORKER_ID = "33333333-3333-3333-3333-333333333333";
const SESSION_ID = "44444444-4444-4444-4444-444444444444";
const MUTATED_SHA = "d".repeat(64);

function previewOnlyPayload(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    planId: "plan-1",
    planRevision: 1,
    sourceProjectSha256: "a".repeat(64),
    sourceProjectPath: "C:\\DYO-Agent\\copies\\source.aep",
    executionSessionId: SESSION_ID,
    expectedWorkingProjectSha256: MUTATED_SHA,
    scenePlanId: "scene-1",
    manifestCompositionId: "comp-1",
    aeProjectItemIndex: 1,
    compositionName: "Scene 01",
    approvedMappingIds: [],
    operations: [],
    checkpoint: null,
    previewOnly: true,
    previewTimestampSeconds: 3,
    ...overrides
  };
}

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    executionSessionId: SESSION_ID,
    scenePlanId: "scene-1",
    sourceProjectSha256: "a".repeat(64),
    workingProjectPath: "C:\\DYO-Agent\\execution-sessions\\session-1\\working-copy.aep",
    workingProjectSha256: MUTATED_SHA,
    workingCopyFailureCode: null,
    operationsRequested: 0,
    operationsCompleted: [],
    checkpoint: { completedOperationIndices: [], checkpointBeforeAt: null, checkpointAfterAt: null, failureReason: null },
    previewFramePath: "C:\\DYO-Agent\\preview.png",
    previewTimestampSeconds: 3,
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
    payload: previewOnlyPayload(),
    result: validResult(),
    error: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides
  } as JobDto;
}

async function setupSession(repo: InMemoryExecutionSessionRepository) {
  const created = await repo.create(
    {
      id: SESSION_ID,
      projectId: PROJECT_ID,
      executionPlanId: "plan-1",
      planRevision: 1,
      sourceProjectSha256: "a".repeat(64),
      assignedWorkerId: WORKER_ID
    },
    NOW
  );
  // Simulate the session already having real completed work + a rejected
  // First Preview, exactly the recoverable state resolveRegeneratePreviewOnly
  // requires - never constructed via a raw repository write in production,
  // only here as test setup.
  await repo.recordSceneCompleted(SESSION_ID, "scene-1", MUTATED_SHA, "AWAITING_PREVIEW_APPROVAL", NOW);
  await repo.recordPreview(SESSION_ID, { storageKey: `${PROJECT_ID}/preview-1.png`, sha256: "e".repeat(64), scenePlanId: "scene-1", capturedAt: NOW }, NOW);
  await repo.markStatus(SESSION_ID, "FAILED", NOW);
  return created;
}

describe("recordRegeneratePreviewResultIfApplicable", () => {
  it("brings a FAILED (rejected-preview) session back to AWAITING_PREVIEW_APPROVAL on a genuine previewOnly success - never touches completedScenePlanIds", async () => {
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupSession(executionSessionRepository);

    await recordRegeneratePreviewResultIfApplicable({ executionSessionRepository, now: () => NOW }, baseJob());

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.status).toBe("AWAITING_PREVIEW_APPROVAL");
    expect(session?.completedScenePlanIds).toEqual(["scene-1"]);
    expect(session?.latestWorkingProjectSha256).toBe(MUTATED_SHA);
  });

  it("idempotently keeps an already-AWAITING_PREVIEW_APPROVAL session in that same state on success", async () => {
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupSession(executionSessionRepository);
    await executionSessionRepository.markStatus(SESSION_ID, "AWAITING_PREVIEW_APPROVAL", NOW);

    await recordRegeneratePreviewResultIfApplicable({ executionSessionRepository, now: () => NOW }, baseJob());

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.status).toBe("AWAITING_PREVIEW_APPROVAL");
  });

  it("marks/keeps the session FAILED on a chain-of-custody failure (e.g. WORKING_COPY_UNEXPECTEDLY_MUTATED) - just as severe during a supposedly read-only recapture", async () => {
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupSession(executionSessionRepository);

    await recordRegeneratePreviewResultIfApplicable(
      { executionSessionRepository, now: () => NOW },
      baseJob({
        status: "FAILED",
        result: validResult({ failureReason: "SAFETY CHECK FAILED", workingCopyFailureCode: "WORKING_COPY_UNEXPECTEDLY_MUTATED" })
      })
    );

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.status).toBe("FAILED");
  });

  it("leaves the session exactly as it was on an ordinary capture failure (no working-copy hash) - retryable, never resurrected", async () => {
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupSession(executionSessionRepository);

    await recordRegeneratePreviewResultIfApplicable(
      { executionSessionRepository, now: () => NOW },
      baseJob({ status: "FAILED", result: validResult({ failureReason: "preview capture failed: AE not responding", workingProjectSha256: null }) })
    );

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.status).toBe("FAILED");
  });

  it("ignores a normal (non-previewOnly) EXECUTE_FRAME job entirely - handled by the disjoint recordExecuteFrameResultIfApplicable instead", async () => {
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupSession(executionSessionRepository);

    await recordRegeneratePreviewResultIfApplicable(
      { executionSessionRepository, now: () => NOW },
      baseJob({ payload: { ...previewOnlyPayload(), previewOnly: false, operations: [{ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, text: "x" }], approvedMappingIds: ["m-1"] } })
    );

    // Status untouched by this function - still FAILED, since only the
    // OTHER (disjoint) handler acts on a non-previewOnly job.
    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.status).toBe("FAILED");
  });

  it("never touches a genuinely COMPLETED session", async () => {
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupSession(executionSessionRepository);
    await executionSessionRepository.markStatus(SESSION_ID, "COMPLETED", NOW);

    await recordRegeneratePreviewResultIfApplicable({ executionSessionRepository, now: () => NOW }, baseJob());

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.status).toBe("COMPLETED");
  });

  it("ignores a non-EXECUTE_FRAME operation entirely", async () => {
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupSession(executionSessionRepository);

    await recordRegeneratePreviewResultIfApplicable({ executionSessionRepository, now: () => NOW }, baseJob({ operation: "RENDER" }));

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.status).toBe("FAILED");
  });

  it("is a harmless no-op when the referenced session does not exist", async () => {
    const executionSessionRepository = new InMemoryExecutionSessionRepository();

    await expect(recordRegeneratePreviewResultIfApplicable({ executionSessionRepository, now: () => NOW }, baseJob())).resolves.toBeUndefined();
  });
});
