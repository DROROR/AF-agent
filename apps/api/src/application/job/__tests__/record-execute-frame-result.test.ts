import { describe, expect, it } from "vitest";
import type { JobDto } from "@dyo/schemas";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { InMemoryExecutionSessionRepository } from "../../execution-session/test-support/in-memory-execution-session-repository.js";
import { recordExecuteFrameResultIfApplicable } from "../record-execute-frame-result.js";

const NOW = new Date("2026-08-27T00:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const WORKER_ID = "33333333-3333-3333-3333-333333333333";
const SESSION_ID = "44444444-4444-4444-4444-444444444444";

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    executionSessionId: SESSION_ID,
    scenePlanId: "scene-1",
    sourceProjectSha256: "a".repeat(64),
    workingProjectPath: "/work/execution-sessions/session-1/working-copy.aep",
    workingProjectSha256: "b".repeat(64),
    workingCopyFailureCode: null,
    operationsRequested: 1,
    operationsCompleted: [0],
    checkpoint: { completedOperationIndices: [0], checkpointBeforeAt: null, checkpointAfterAt: NOW.toISOString(), failureReason: null },
    previewFramePath: "/work/execution-sessions/session-1/preview.png",
    previewTimestampSeconds: 0,
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

async function setupPlan(repo: InMemoryExecutionPlanRepository) {
  return repo.createRevision(
    {
      id: "plan-1",
      projectId: PROJECT_ID,
      revision: 1,
      status: "APPROVED",
      templateId: "tmpl-1",
      sourceProjectSha256: "a".repeat(64),
      scenePlans: [],
      approvedAt: NOW,
      approvedBy: "user-1"
    },
    NOW
  );
}

async function setupSession(repo: InMemoryExecutionSessionRepository, overrides: Partial<{ id: string; planRevision: number }> = {}) {
  return repo.create(
    {
      id: overrides.id ?? SESSION_ID,
      projectId: PROJECT_ID,
      executionPlanId: "plan-1",
      planRevision: overrides.planRevision ?? 1,
      sourceProjectSha256: "a".repeat(64),
      assignedWorkerId: WORKER_ID
    },
    NOW
  );
}

describe("recordExecuteFrameResultIfApplicable", () => {
  it("appends the completed scene and advances latestWorkingProjectSha256 for a genuinely SUCCEEDED EXECUTE_FRAME job", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);

    await recordExecuteFrameResultIfApplicable({ executionSessionRepository, executionPlanRepository, now: () => NOW }, baseJob());

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.completedScenePlanIds).toEqual(["scene-1"]);
    expect(session?.latestWorkingProjectSha256).toBe("b".repeat(64));
    // First scene completed, preview not yet approved.
    expect(session?.status).toBe("AWAITING_PREVIEW_APPROVAL");
  });

  it("never touches the session for a FAILED job, even one that reports a result-shaped payload", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);

    await recordExecuteFrameResultIfApplicable(
      { executionSessionRepository, executionPlanRepository, now: () => NOW },
      baseJob({ status: "FAILED", result: validResult({ failureReason: "operation 0 failed" }) })
    );

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.completedScenePlanIds).toEqual([]);
  });

  it("never persists when the result's own failureReason is non-null, even if job.status somehow says SUCCEEDED", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);

    await recordExecuteFrameResultIfApplicable(
      { executionSessionRepository, executionPlanRepository, now: () => NOW },
      baseJob({ result: validResult({ failureReason: "should never happen alongside SUCCEEDED" }) })
    );

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.completedScenePlanIds).toEqual([]);
  });

  it("never persists when workingProjectSha256 is null (failure before a working copy could be prepared)", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);

    await recordExecuteFrameResultIfApplicable(
      { executionSessionRepository, executionPlanRepository, now: () => NOW },
      baseJob({ result: validResult({ workingProjectPath: null, workingProjectSha256: null }) })
    );

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.completedScenePlanIds).toEqual([]);
  });

  it("marks the session FAILED (terminal) on a chain-of-custody failure (workingCopyFailureCode set) - never silently recreates the working copy", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);

    await recordExecuteFrameResultIfApplicable(
      { executionSessionRepository, executionPlanRepository, now: () => NOW },
      baseJob({
        status: "FAILED",
        result: validResult({
          failureReason: "working copy could not be prepared (WORKING_COPY_MISSING): ...",
          workingCopyFailureCode: "WORKING_COPY_MISSING",
          workingProjectPath: null,
          workingProjectSha256: null
        })
      })
    );

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.status).toBe("FAILED");
    expect(session?.completedScenePlanIds).toEqual([]);
  });

  it("ignores a non-EXECUTE_FRAME operation entirely", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);

    await recordExecuteFrameResultIfApplicable({ executionSessionRepository, executionPlanRepository, now: () => NOW }, baseJob({ operation: "RENDER" }));

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.completedScenePlanIds).toEqual([]);
  });

  it("is a harmless no-op when the job has no projectId", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);

    await expect(
      recordExecuteFrameResultIfApplicable({ executionSessionRepository, executionPlanRepository, now: () => NOW }, baseJob({ projectId: null }))
    ).resolves.toBeUndefined();
  });

  it("is a harmless no-op when the referenced session does not exist", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupPlan(executionPlanRepository);

    await expect(
      recordExecuteFrameResultIfApplicable({ executionSessionRepository, executionPlanRepository, now: () => NOW }, baseJob())
    ).resolves.toBeUndefined();
  });

  it("never touches an already-terminal session (a stale/duplicate report arriving after FAILED/COMPLETED must not resurrect it)", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);
    await executionSessionRepository.markStatus(SESSION_ID, "COMPLETED", NOW);

    await recordExecuteFrameResultIfApplicable({ executionSessionRepository, executionPlanRepository, now: () => NOW }, baseJob());

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.status).toBe("COMPLETED");
    expect(session?.completedScenePlanIds).toEqual([]);
  });

  it("accumulates across multiple successful scene jobs in the same session - never overwrites, and advances the chain-of-custody head each time", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await setupPlan(executionPlanRepository);
    await setupSession(executionSessionRepository);

    await recordExecuteFrameResultIfApplicable({ executionSessionRepository, executionPlanRepository, now: () => NOW }, baseJob());
    await recordExecuteFrameResultIfApplicable(
      { executionSessionRepository, executionPlanRepository, now: () => NOW },
      baseJob({ jobId: "job-3", result: validResult({ scenePlanId: "scene-2", workingProjectSha256: "c".repeat(64) }) })
    );

    const session = await executionSessionRepository.findById(SESSION_ID);
    expect(session?.completedScenePlanIds).toEqual(["scene-1", "scene-2"]);
    expect(session?.latestWorkingProjectSha256).toBe("c".repeat(64));
  });
});
