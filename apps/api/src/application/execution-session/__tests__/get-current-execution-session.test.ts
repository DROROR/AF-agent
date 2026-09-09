import { describe, expect, it } from "vitest";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { InMemoryExecutionSessionRepository } from "../test-support/in-memory-execution-session-repository.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryJobRepository } from "../../job/test-support/in-memory-job-repository.js";
import { getCurrentExecutionSession } from "../get-current-execution-session.js";

const NOW = new Date("2026-09-09T00:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const WORKER_ID = "33333333-3333-3333-3333-333333333333";
const SESSION_ID = "44444444-4444-4444-4444-444444444444";
const STALE_AFTER_MS = 30_000;

async function setup() {
  const executionSessionRepository = new InMemoryExecutionSessionRepository();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const workerRepository = new InMemoryWorkerRepository();
  const jobRepository = new InMemoryJobRepository();

  await workerRepository.create({ id: WORKER_ID, name: "worker-a", tokenHash: "hash", maxConcurrency: 1, capabilities: ["EXECUTE_FRAME"] }, NOW);
  await workerRepository.updateHeartbeat(WORKER_ID, { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0", capabilities: ["EXECUTE_FRAME"], maxConcurrency: 1, currentJobId: null }, NOW);
  await executionPlanRepository.createRevision(
    {
      id: "plan-1",
      projectId: PROJECT_ID,
      revision: 4,
      status: "APPROVED",
      templateId: "tmpl-1",
      sourceProjectSha256: "a".repeat(64),
      scenePlans: [],
      approvedAt: NOW,
      approvedBy: "user-1"
    },
    NOW
  );
  await executionSessionRepository.create(
    { id: SESSION_ID, projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 4, sourceProjectSha256: "a".repeat(64), assignedWorkerId: WORKER_ID },
    NOW
  );

  return { executionSessionRepository, executionPlanRepository, workerRepository, jobRepository };
}

function deps(repos: Awaited<ReturnType<typeof setup>>) {
  return { ...repos, now: () => NOW, staleAfterMs: STALE_AFTER_MS };
}

describe("getCurrentExecutionSession", () => {
  it("returns null for a genuinely inactive (stale plan revision) session - unchanged prior behavior", async () => {
    const repos = await setup();
    await repos.executionSessionRepository.recordSceneCompleted(SESSION_ID, "scene-1", "b".repeat(64), "AWAITING_PREVIEW_APPROVAL", NOW);
    await repos.executionPlanRepository.createRevision(
      { id: "plan-2", projectId: PROJECT_ID, revision: 5, status: "APPROVED", templateId: "tmpl-1", sourceProjectSha256: "a".repeat(64), scenePlans: [], approvedAt: NOW, approvedBy: "user-1" },
      NOW
    );

    const result = await getCurrentExecutionSession(deps(repos), PROJECT_ID);
    expect(result.session).toBeNull();
  });

  it("returns a normal AWAITING_PREVIEW_APPROVAL session (unchanged prior behavior)", async () => {
    const repos = await setup();
    await repos.executionSessionRepository.recordSceneCompleted(SESSION_ID, "scene-1", "b".repeat(64), "AWAITING_PREVIEW_APPROVAL", NOW);

    const result = await getCurrentExecutionSession(deps(repos), PROJECT_ID);
    expect(result.session?.id).toBe(SESSION_ID);
    expect(result.session?.status).toBe("AWAITING_PREVIEW_APPROVAL");
  });

  /**
   * The exact 2026-09-09 regression: isSessionActive alone correctly
   * calls a FAILED session inactive, but this function must still return
   * it when it's recoverable for First Preview regeneration - otherwise
   * ProjectPreviewTab's own "current session" fetch sees null and falls
   * back to "Start execution", even though the fix for that exact case
   * was already deployed at the resolver/executor/UI layers.
   */
  it("STILL returns a FAILED session that is recoverable for First Preview regeneration - the exact 2026-09-09 bug this closes", async () => {
    const repos = await setup();
    await repos.executionSessionRepository.recordSceneCompleted(SESSION_ID, "scene-1", "b".repeat(64), "AWAITING_PREVIEW_APPROVAL", NOW);
    await repos.executionSessionRepository.recordPreview(SESSION_ID, { storageKey: `${PROJECT_ID}/preview-1.png`, sha256: "c".repeat(64), scenePlanId: "scene-1", capturedAt: NOW }, NOW);
    await repos.executionSessionRepository.markStatus(SESSION_ID, "FAILED", NOW);

    const result = await getCurrentExecutionSession(deps(repos), PROJECT_ID);
    expect(result.session).not.toBeNull();
    expect(result.session?.id).toBe(SESSION_ID);
    expect(result.session?.status).toBe("FAILED");
    expect(result.session?.completedScenePlanIds).toEqual(["scene-1"]);
    expect(result.session?.latestWorkingProjectSha256).toBe("b".repeat(64));
    expect(result.session?.latestPreviewScenePlanId).toBe("scene-1");
  });

  it("returns null for a FAILED session with NO completed work - a genuine chain-of-custody/other failure, never treated as recoverable", async () => {
    const repos = await setup();
    await repos.executionSessionRepository.markStatus(SESSION_ID, "FAILED", NOW);

    const result = await getCurrentExecutionSession(deps(repos), PROJECT_ID);
    expect(result.session).toBeNull();
  });

  it("returns null for a FAILED session with completed work but a stale plan revision - never bypasses the plan-revision check", async () => {
    const repos = await setup();
    await repos.executionSessionRepository.recordSceneCompleted(SESSION_ID, "scene-1", "b".repeat(64), "AWAITING_PREVIEW_APPROVAL", NOW);
    await repos.executionSessionRepository.recordPreview(SESSION_ID, { storageKey: `${PROJECT_ID}/preview-1.png`, sha256: "c".repeat(64), scenePlanId: "scene-1", capturedAt: NOW }, NOW);
    await repos.executionSessionRepository.markStatus(SESSION_ID, "FAILED", NOW);
    await repos.executionPlanRepository.createRevision(
      { id: "plan-2", projectId: PROJECT_ID, revision: 5, status: "APPROVED", templateId: "tmpl-1", sourceProjectSha256: "a".repeat(64), scenePlans: [], approvedAt: NOW, approvedBy: "user-1" },
      NOW
    );

    const result = await getCurrentExecutionSession(deps(repos), PROJECT_ID);
    expect(result.session).toBeNull();
  });

  it("returns null for a genuinely COMPLETED session - never resurrects a real terminal completion", async () => {
    const repos = await setup();
    await repos.executionSessionRepository.recordSceneCompleted(SESSION_ID, "scene-1", "b".repeat(64), "COMPLETED", NOW);
    await repos.executionSessionRepository.markStatus(SESSION_ID, "COMPLETED", NOW);

    const result = await getCurrentExecutionSession(deps(repos), PROJECT_ID);
    expect(result.session).toBeNull();
  });
});
