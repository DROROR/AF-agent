import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ExecutionSessionNotFoundError } from "../../../errors/app-error.js";
import { InMemoryExecutionSessionRepository } from "../test-support/in-memory-execution-session-repository.js";
import { requestFinalPreviewChanges } from "../request-final-preview-changes.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const WORKER_ID = "22222222-2222-2222-2222-222222222222";

function deps() {
  const executionSessionRepository = new InMemoryExecutionSessionRepository();
  return { executionSessionRepository, now: () => NOW };
}

/**
 * Client-handoff phase, "real final preview approval gate", section 5
 * ("Request Changes Safety") - proves this NEVER touches session status,
 * completedScenePlanIds, or the cumulative working copy - only the one
 * fullPreviewApproved flag - and is safe to call regardless of the
 * session's current status (unlike rejectFirstPreview's own terminal
 * FAILED transition).
 */
describe("requestFinalPreviewChanges", () => {
  it("throws ExecutionSessionNotFoundError for an unknown session", async () => {
    const d = deps();
    await expect(requestFinalPreviewChanges(d, PROJECT_ID, randomUUID())).rejects.toThrow(ExecutionSessionNotFoundError);
  });

  it("throws ExecutionSessionNotFoundError for a session belonging to a different project", async () => {
    const d = deps();
    const session = await d.executionSessionRepository.create(
      { id: randomUUID(), projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: WORKER_ID },
      NOW
    );
    await expect(requestFinalPreviewChanges(d, "99999999-9999-9999-9999-999999999999", session.id)).rejects.toThrow(ExecutionSessionNotFoundError);
  });

  it("clears fullPreviewApproved back to false, and NEVER touches session status, completedScenePlanIds, or the working copy", async () => {
    const d = deps();
    const session = await d.executionSessionRepository.create(
      { id: randomUUID(), projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: WORKER_ID },
      NOW
    );
    await d.executionSessionRepository.recordSceneCompleted(session.id, "scene-1", "d".repeat(64), "AWAITING_PREVIEW_APPROVAL", NOW);
    await d.executionSessionRepository.approvePreview(session.id, "READY_TO_RENDER", NOW);
    await d.executionSessionRepository.setFullPreviewApproved(session.id, true, NOW);

    const dto = await requestFinalPreviewChanges(d, PROJECT_ID, session.id);

    expect(dto.fullPreviewApproved).toBe(false);
    // Nothing else about the session's real progress was touched.
    expect(dto.status).toBe("READY_TO_RENDER");
    expect(dto.completedScenePlanIds).toEqual(["scene-1"]);
    expect(dto.latestWorkingProjectSha256).toBe("d".repeat(64));
    expect(dto.firstPreviewApproved).toBe(true);
  });

  it("is idempotent - calling it when fullPreviewApproved is already false never errors", async () => {
    const d = deps();
    const session = await d.executionSessionRepository.create(
      { id: randomUUID(), projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: WORKER_ID },
      NOW
    );
    const dto = await requestFinalPreviewChanges(d, PROJECT_ID, session.id);
    expect(dto.fullPreviewApproved).toBe(false);
  });
});
