import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { JobDto } from "@dyo/schemas";
import { InMemoryRenderArtifactRepository } from "../test-support/in-memory-render-artifact-repository.js";
import { InMemoryRenderArtifactUploadRepository } from "../test-support/in-memory-render-artifact-upload-repository.js";
import { InMemoryExecutionSessionRepository } from "../../execution-session/test-support/in-memory-execution-session-repository.js";
import { recordRenderArtifactIfApplicable } from "../record-render-artifact.js";

const NOW = new Date("2026-08-27T00:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_ID = "55555555-5555-5555-5555-555555555555";

function validArtifact(overrides: Record<string, unknown> = {}) {
  return {
    variant: "LANDSCAPE",
    workingProjectSha256: "b".repeat(64),
    compositionName: "Landscape Master",
    filename: "output.mp4",
    mimeType: "video/mp4",
    byteSize: 12345,
    renderStartedAt: NOW.toISOString(),
    renderCompletedAt: new Date(NOW.getTime() + 1000).toISOString(),
    aerenderExitCode: 0,
    logExcerpt: "rendered fine",
    validationStatus: "VALID",
    validationFailureReason: null,
    ...overrides
  };
}

function baseJob(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: JOB_ID,
    workerId: "33333333-3333-3333-3333-333333333333",
    projectId: PROJECT_ID,
    operation: "RENDER",
    status: "SUCCEEDED",
    payload: {},
    result: {
      executionSessionId: SESSION_ID,
      variant: "LANDSCAPE",
      workingProjectSha256: "b".repeat(64),
      artifact: validArtifact(),
      checkpoint: { completedOperationIndices: [0, 1, 2, 3], checkpointBeforeAt: null, checkpointAfterAt: NOW.toISOString(), failureReason: null },
      failureReason: null,
      startedAt: NOW.toISOString(),
      completedAt: new Date(NOW.getTime() + 2000).toISOString()
    },
    error: null,
    checkpoint: null,
    createdAt: NOW.toISOString(),
    claimedAt: NOW.toISOString(),
    startedAt: NOW.toISOString(),
    completedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides
  };
}

/** Seeds a matching render_artifact_uploads row (real, server-verified bytes) for the given jobId - see record-render-artifact.ts's own doc comment on why this must exist before a render_artifacts row is ever created. */
async function seedUpload(
  renderArtifactUploadRepository: InMemoryRenderArtifactUploadRepository,
  jobId: string,
  overrides: Record<string, unknown> = {}
) {
  await renderArtifactUploadRepository.insert(
    {
      id: randomUUID(),
      projectId: PROJECT_ID,
      jobId,
      variant: "LANDSCAPE",
      storageKey: `${PROJECT_ID}/${randomUUID()}.mp4`,
      sha256: "c".repeat(64),
      byteSize: 12345,
      mimeType: "video/mp4",
      ...overrides
    },
    NOW
  );
}

describe("recordRenderArtifactIfApplicable", () => {
  it("stores a valid SUCCEEDED RENDER result with a VALID artifact AND a matching real upload", async () => {
    const renderArtifactRepository = new InMemoryRenderArtifactRepository();
    const renderArtifactUploadRepository = new InMemoryRenderArtifactUploadRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await executionSessionRepository.create({ id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: "33333333-3333-3333-3333-333333333333" }, NOW);
    await seedUpload(renderArtifactUploadRepository, JOB_ID);

    await recordRenderArtifactIfApplicable({ renderArtifactRepository, renderArtifactUploadRepository, executionSessionRepository, now: () => NOW }, baseJob());

    const rows = await renderArtifactRepository.listByProject(PROJECT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.variant).toBe("LANDSCAPE");
    // Prefers the upload's own server-verified byteSize over the worker's self-reported artifact.byteSize.
    expect(rows[0]?.byteSize).toBe(12345);
    expect(rows[0]?.validationStatus).toBe("VALID");
    expect(rows[0]?.sha256).toBe("c".repeat(64));
  });

  it("never stores anything when NO matching upload exists yet, even with an otherwise fully valid SUCCEEDED result", async () => {
    const renderArtifactRepository = new InMemoryRenderArtifactRepository();
    const renderArtifactUploadRepository = new InMemoryRenderArtifactUploadRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await executionSessionRepository.create({ id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: "33333333-3333-3333-3333-333333333333" }, NOW);
    // Deliberately no seedUpload() call - the worker's own report arrived
    // without ever having uploaded real bytes for this job.
    await recordRenderArtifactIfApplicable({ renderArtifactRepository, renderArtifactUploadRepository, executionSessionRepository, now: () => NOW }, baseJob());
    expect(await renderArtifactRepository.listByProject(PROJECT_ID)).toEqual([]);
  });

  it("never stores anything for a non-SUCCEEDED job", async () => {
    const renderArtifactRepository = new InMemoryRenderArtifactRepository();
    const renderArtifactUploadRepository = new InMemoryRenderArtifactUploadRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await executionSessionRepository.create({ id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: "33333333-3333-3333-3333-333333333333" }, NOW);
    await seedUpload(renderArtifactUploadRepository, JOB_ID);
    await recordRenderArtifactIfApplicable(
      { renderArtifactRepository, renderArtifactUploadRepository, executionSessionRepository, now: () => NOW },
      baseJob({ status: "FAILED" })
    );
    expect(await renderArtifactRepository.listByProject(PROJECT_ID)).toEqual([]);
  });

  it("never stores anything for a different operation", async () => {
    const renderArtifactRepository = new InMemoryRenderArtifactRepository();
    const renderArtifactUploadRepository = new InMemoryRenderArtifactUploadRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await executionSessionRepository.create({ id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: "33333333-3333-3333-3333-333333333333" }, NOW);
    await seedUpload(renderArtifactUploadRepository, JOB_ID);
    await recordRenderArtifactIfApplicable(
      { renderArtifactRepository, renderArtifactUploadRepository, executionSessionRepository, now: () => NOW },
      baseJob({ operation: "EXECUTE_FRAME" })
    );
    expect(await renderArtifactRepository.listByProject(PROJECT_ID)).toEqual([]);
  });

  it("never stores anything when artifact is null (render never reached a valid output)", async () => {
    const renderArtifactRepository = new InMemoryRenderArtifactRepository();
    const renderArtifactUploadRepository = new InMemoryRenderArtifactUploadRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await executionSessionRepository.create({ id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: "33333333-3333-3333-3333-333333333333" }, NOW);
    await seedUpload(renderArtifactUploadRepository, JOB_ID);
    const job = baseJob({
      result: {
        executionSessionId: SESSION_ID,
        variant: "LANDSCAPE",
        workingProjectSha256: "b".repeat(64),
        artifact: null,
        checkpoint: { completedOperationIndices: [0, 1], checkpointBeforeAt: null, checkpointAfterAt: NOW.toISOString(), failureReason: "aerender exited with code 1" },
        failureReason: "aerender exited with code 1",
        startedAt: NOW.toISOString(),
        completedAt: new Date(NOW.getTime() + 2000).toISOString()
      }
    });
    // Note: a job with a null artifact and a non-null failureReason would
    // actually be reported as FAILED by job-dispatcher.ts in practice, but
    // this guards the persistence function itself independently of that -
    // never partially trusted, never persisted, regardless of job.status.
    await recordRenderArtifactIfApplicable({ renderArtifactRepository, renderArtifactUploadRepository, executionSessionRepository, now: () => NOW }, job);
    expect(await renderArtifactRepository.listByProject(PROJECT_ID)).toEqual([]);
  });

  it("never stores anything when the artifact's own validationStatus is INVALID", async () => {
    const renderArtifactRepository = new InMemoryRenderArtifactRepository();
    const renderArtifactUploadRepository = new InMemoryRenderArtifactUploadRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await executionSessionRepository.create({ id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: "33333333-3333-3333-3333-333333333333" }, NOW);
    await seedUpload(renderArtifactUploadRepository, JOB_ID);
    const job = baseJob({
      result: {
        executionSessionId: SESSION_ID,
        variant: "LANDSCAPE",
        workingProjectSha256: "b".repeat(64),
        artifact: validArtifact({ validationStatus: "INVALID", validationFailureReason: "zero bytes" }),
        checkpoint: { completedOperationIndices: [0, 1, 2], checkpointBeforeAt: null, checkpointAfterAt: NOW.toISOString(), failureReason: "artifact validation failed: zero bytes" },
        failureReason: "artifact validation failed: zero bytes",
        startedAt: NOW.toISOString(),
        completedAt: new Date(NOW.getTime() + 2000).toISOString()
      }
    });
    await recordRenderArtifactIfApplicable({ renderArtifactRepository, renderArtifactUploadRepository, executionSessionRepository, now: () => NOW }, job);
    expect(await renderArtifactRepository.listByProject(PROJECT_ID)).toEqual([]);
  });

  it("discards a malformed result - never partially trusted, never persisted", async () => {
    const renderArtifactRepository = new InMemoryRenderArtifactRepository();
    const renderArtifactUploadRepository = new InMemoryRenderArtifactUploadRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await executionSessionRepository.create({ id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: "33333333-3333-3333-3333-333333333333" }, NOW);
    await seedUpload(renderArtifactUploadRepository, JOB_ID);
    await recordRenderArtifactIfApplicable(
      { renderArtifactRepository, renderArtifactUploadRepository, executionSessionRepository, now: () => NOW },
      baseJob({ result: { nonsense: true } })
    );
    expect(await renderArtifactRepository.listByProject(PROJECT_ID)).toEqual([]);
  });

  it("skips a job that has no projectId", async () => {
    const renderArtifactRepository = new InMemoryRenderArtifactRepository();
    const renderArtifactUploadRepository = new InMemoryRenderArtifactUploadRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await executionSessionRepository.create({ id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: "33333333-3333-3333-3333-333333333333" }, NOW);
    await seedUpload(renderArtifactUploadRepository, JOB_ID);
    await recordRenderArtifactIfApplicable(
      { renderArtifactRepository, renderArtifactUploadRepository, executionSessionRepository, now: () => NOW },
      baseJob({ projectId: null })
    );
    expect(await renderArtifactRepository.listByProject(PROJECT_ID)).toEqual([]);
  });

  it("is idempotent for a duplicate/retried call against the same jobId - never creates a second record", async () => {
    const renderArtifactRepository = new InMemoryRenderArtifactRepository();
    const renderArtifactUploadRepository = new InMemoryRenderArtifactUploadRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await executionSessionRepository.create({ id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: "33333333-3333-3333-3333-333333333333" }, NOW);
    await seedUpload(renderArtifactUploadRepository, JOB_ID);
    const job = baseJob();
    await recordRenderArtifactIfApplicable({ renderArtifactRepository, renderArtifactUploadRepository, executionSessionRepository, now: () => NOW }, job);
    await recordRenderArtifactIfApplicable({ renderArtifactRepository, renderArtifactUploadRepository, executionSessionRepository, now: () => NOW }, job);

    expect(await renderArtifactRepository.listByProject(PROJECT_ID)).toHaveLength(1);
  });

  it("preserves multiple historical records across different jobs (e.g. LANDSCAPE and REELS), never overwriting", async () => {
    const renderArtifactRepository = new InMemoryRenderArtifactRepository();
    const renderArtifactUploadRepository = new InMemoryRenderArtifactUploadRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    await executionSessionRepository.create({ id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: "33333333-3333-3333-3333-333333333333" }, NOW);
    await seedUpload(renderArtifactUploadRepository, "job-landscape");
    await seedUpload(renderArtifactUploadRepository, "job-reels", { variant: "REELS" });

    await recordRenderArtifactIfApplicable(
      { renderArtifactRepository, renderArtifactUploadRepository, executionSessionRepository, now: () => NOW },
      baseJob({ jobId: "job-landscape" })
    );
    await recordRenderArtifactIfApplicable(
      { renderArtifactRepository, renderArtifactUploadRepository, executionSessionRepository, now: () => new Date(NOW.getTime() + 5000) },
      baseJob({
        jobId: "job-reels",
        result: {
          executionSessionId: SESSION_ID,
          variant: "REELS",
          workingProjectSha256: "b".repeat(64),
          artifact: validArtifact({ variant: "REELS", compositionName: "Reels Master" }),
          checkpoint: { completedOperationIndices: [0, 1, 2, 3], checkpointBeforeAt: null, checkpointAfterAt: NOW.toISOString(), failureReason: null },
          failureReason: null,
          startedAt: NOW.toISOString(),
          completedAt: new Date(NOW.getTime() + 2000).toISOString()
        }
      })
    );

    const rows = await renderArtifactRepository.listByProject(PROJECT_ID);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.variant).sort()).toEqual(["LANDSCAPE", "REELS"]);
  });
});
