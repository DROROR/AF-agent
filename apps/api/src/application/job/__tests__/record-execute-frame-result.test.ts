import { describe, expect, it } from "vitest";
import type { JobDto } from "@dyo/schemas";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { recordExecuteFrameResultIfApplicable } from "../record-execute-frame-result.js";

const NOW = new Date("2026-08-27T00:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    scenePlanId: "scene-1",
    sourceProjectSha256: "a".repeat(64),
    workingProjectPath: "/work/jobs/job-2/working-copy.aep",
    workingProjectSha256: "b".repeat(64),
    operationsRequested: 1,
    operationsCompleted: [0],
    checkpoint: { completedOperationIndices: [0], checkpointBeforeAt: null, checkpointAfterAt: NOW.toISOString(), failureReason: null },
    previewFramePath: "/work/jobs/job-2/preview.png",
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
    workerId: "33333333-3333-3333-3333-333333333333",
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

describe("recordExecuteFrameResultIfApplicable", () => {
  it("persists the working-copy identity onto the current plan for a genuinely SUCCEEDED EXECUTE_FRAME job", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    await setupPlan(executionPlanRepository);

    await recordExecuteFrameResultIfApplicable({ executionPlanRepository, now: () => NOW }, baseJob());

    const plan = await executionPlanRepository.findCurrentByProjectId(PROJECT_ID);
    expect(plan?.workingProjectPath).toBe("/work/jobs/job-2/working-copy.aep");
    expect(plan?.workingProjectSha256).toBe("b".repeat(64));
  });

  it("never persists anything for a FAILED job, even one that reports a result-shaped payload", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    await setupPlan(executionPlanRepository);

    await recordExecuteFrameResultIfApplicable(
      { executionPlanRepository, now: () => NOW },
      baseJob({ status: "FAILED", result: validResult({ failureReason: "operation 0 failed" }) })
    );

    const plan = await executionPlanRepository.findCurrentByProjectId(PROJECT_ID);
    expect(plan?.workingProjectPath).toBeNull();
  });

  it("never persists when the result's own failureReason is non-null, even if job.status somehow says SUCCEEDED", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    await setupPlan(executionPlanRepository);

    await recordExecuteFrameResultIfApplicable(
      { executionPlanRepository, now: () => NOW },
      baseJob({ result: validResult({ failureReason: "should never happen alongside SUCCEEDED" }) })
    );

    const plan = await executionPlanRepository.findCurrentByProjectId(PROJECT_ID);
    expect(plan?.workingProjectPath).toBeNull();
  });

  it("never persists when workingProjectPath/Sha256 are null (failure before a working copy could be prepared)", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    await setupPlan(executionPlanRepository);

    await recordExecuteFrameResultIfApplicable(
      { executionPlanRepository, now: () => NOW },
      baseJob({ result: validResult({ workingProjectPath: null, workingProjectSha256: null }) })
    );

    const plan = await executionPlanRepository.findCurrentByProjectId(PROJECT_ID);
    expect(plan?.workingProjectPath).toBeNull();
  });

  it("ignores a non-EXECUTE_FRAME operation entirely", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    await setupPlan(executionPlanRepository);

    await recordExecuteFrameResultIfApplicable({ executionPlanRepository, now: () => NOW }, baseJob({ operation: "RENDER" }));

    const plan = await executionPlanRepository.findCurrentByProjectId(PROJECT_ID);
    expect(plan?.workingProjectPath).toBeNull();
  });

  it("is a harmless no-op when the job has no projectId", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    await setupPlan(executionPlanRepository);

    await expect(
      recordExecuteFrameResultIfApplicable({ executionPlanRepository, now: () => NOW }, baseJob({ projectId: null }))
    ).resolves.toBeUndefined();
  });

  it("overwrites a PRIOR working-copy identity with the most recently succeeded job's own - never accumulates", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    await setupPlan(executionPlanRepository);

    await recordExecuteFrameResultIfApplicable({ executionPlanRepository, now: () => NOW }, baseJob());
    await recordExecuteFrameResultIfApplicable(
      { executionPlanRepository, now: () => NOW },
      baseJob({ jobId: "job-3", result: validResult({ workingProjectPath: "/work/jobs/job-3/working-copy.aep", workingProjectSha256: "c".repeat(64) }) })
    );

    const plan = await executionPlanRepository.findCurrentByProjectId(PROJECT_ID);
    expect(plan?.workingProjectPath).toBe("/work/jobs/job-3/working-copy.aep");
    expect(plan?.workingProjectSha256).toBe("c".repeat(64));
  });
});
