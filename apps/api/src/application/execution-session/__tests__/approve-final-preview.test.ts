import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ExecutionSessionNotFoundError, PreconditionNotMetError } from "../../../errors/app-error.js";
import { InMemoryExecutionSessionRepository } from "../test-support/in-memory-execution-session-repository.js";
import { InMemoryFullPreviewArtifactRepository } from "../test-support/in-memory-full-preview-artifact-repository.js";
import { approveFinalPreview } from "../approve-final-preview.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const WORKER_ID = "22222222-2222-2222-2222-222222222222";
const WORKING_SHA = "d".repeat(64);

function deps() {
  const executionSessionRepository = new InMemoryExecutionSessionRepository();
  const fullPreviewArtifactRepository = new InMemoryFullPreviewArtifactRepository();
  return { executionSessionRepository, fullPreviewArtifactRepository, now: () => NOW };
}

async function createSessionWithWorkingCopy(executionSessionRepository: InMemoryExecutionSessionRepository) {
  const session = await executionSessionRepository.create(
    { id: randomUUID(), projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: WORKER_ID },
    NOW
  );
  const updated = await executionSessionRepository.recordSceneCompleted(session.id, "scene-1", WORKING_SHA, "AWAITING_PREVIEW_APPROVAL", NOW);
  return updated!;
}

/**
 * Client-handoff phase, "real final preview approval gate" - proves this
 * is a genuinely SEPARATE, persisted approval from firstPreviewApproved,
 * gated on a real, fresh full-preview artifact actually existing.
 */
describe("approveFinalPreview", () => {
  it("throws ExecutionSessionNotFoundError for an unknown session", async () => {
    const d = deps();
    await expect(approveFinalPreview(d, PROJECT_ID, randomUUID())).rejects.toThrow(ExecutionSessionNotFoundError);
  });

  it("throws ExecutionSessionNotFoundError for a session belonging to a different project - never confirms it exists elsewhere", async () => {
    const d = deps();
    const session = await createSessionWithWorkingCopy(d.executionSessionRepository);
    await expect(approveFinalPreview(d, "99999999-9999-9999-9999-999999999999", session.id)).rejects.toThrow(ExecutionSessionNotFoundError);
  });

  it("refuses when no complete-preview artifact has ever been captured yet", async () => {
    const d = deps();
    const session = await createSessionWithWorkingCopy(d.executionSessionRepository);
    await expect(approveFinalPreview(d, PROJECT_ID, session.id)).rejects.toThrow(PreconditionNotMetError);
  });

  it("refuses when the only complete-preview artifact is STALE (captured against an older working copy)", async () => {
    const d = deps();
    const session = await createSessionWithWorkingCopy(d.executionSessionRepository);
    await d.fullPreviewArtifactRepository.record(
      {
        id: randomUUID(),
        projectId: PROJECT_ID,
        executionSessionId: session.id,
        jobId: randomUUID(),
        workingProjectSha256: "b".repeat(64), // different from the session's current working copy
        filename: "preview.mp4",
        mimeType: "video/mp4",
        byteSize: 100,
        storageKey: `${PROJECT_ID}/preview.mp4`,
        sha256: "c".repeat(64),
        capturedAt: NOW
      },
      NOW
    );
    await expect(approveFinalPreview(d, PROJECT_ID, session.id)).rejects.toThrow(PreconditionNotMetError);
  });

  it("approves once a real, fresh complete-preview artifact exists - persists fullPreviewApproved, never firstPreviewApproved", async () => {
    const d = deps();
    const session = await createSessionWithWorkingCopy(d.executionSessionRepository);
    await d.fullPreviewArtifactRepository.record(
      {
        id: randomUUID(),
        projectId: PROJECT_ID,
        executionSessionId: session.id,
        jobId: randomUUID(),
        workingProjectSha256: WORKING_SHA,
        filename: "preview.mp4",
        mimeType: "video/mp4",
        byteSize: 100,
        storageKey: `${PROJECT_ID}/preview.mp4`,
        sha256: "c".repeat(64),
        capturedAt: NOW
      },
      NOW
    );

    const dto = await approveFinalPreview(d, PROJECT_ID, session.id);
    expect(dto.fullPreviewApproved).toBe(true);
    expect(dto.firstPreviewApproved).toBe(false); // never silently flipped as a side effect

    const persisted = await d.executionSessionRepository.findById(session.id);
    expect(persisted?.fullPreviewApproved).toBe(true);
  });
});
