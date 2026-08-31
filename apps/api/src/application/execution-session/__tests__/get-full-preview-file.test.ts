import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ExecutionSessionNotFoundError, FullPreviewNotFoundError } from "../../../errors/app-error.js";
import { InMemoryExecutionSessionRepository } from "../test-support/in-memory-execution-session-repository.js";
import { InMemoryFullPreviewArtifactRepository } from "../test-support/in-memory-full-preview-artifact-repository.js";
import { InMemoryAssetStorage } from "../../asset/test-support/in-memory-asset-storage.js";
import { getFullPreviewFile } from "../get-full-preview-file.js";
import { getFullPreviewMetadata } from "../get-full-preview-metadata.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT_ID = "99999999-9999-9999-9999-999999999999";
const WORKER_ID = "22222222-2222-2222-2222-222222222222";

async function setup() {
  const executionSessionRepository = new InMemoryExecutionSessionRepository();
  const fullPreviewArtifactRepository = new InMemoryFullPreviewArtifactRepository();
  const assetStorage = new InMemoryAssetStorage();
  const session = await executionSessionRepository.create(
    { id: randomUUID(), projectId: PROJECT_ID, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: WORKER_ID },
    NOW
  );
  return { executionSessionRepository, fullPreviewArtifactRepository, assetStorage, session };
}

describe("getFullPreviewFile / getFullPreviewMetadata - authorization and missing-artifact handling", () => {
  it("getFullPreviewMetadata returns null (never an error) when no complete preview has ever been captured - a real, valid state", async () => {
    const { executionSessionRepository, fullPreviewArtifactRepository, session } = await setup();
    const result = await getFullPreviewMetadata({ executionSessionRepository, fullPreviewArtifactRepository }, PROJECT_ID, session.id);
    expect(result).toBeNull();
  });

  it("getFullPreviewFile throws FullPreviewNotFoundError (never a fake placeholder) when no artifact exists yet", async () => {
    const { executionSessionRepository, fullPreviewArtifactRepository, assetStorage, session } = await setup();
    await expect(getFullPreviewFile({ executionSessionRepository, fullPreviewArtifactRepository, assetStorage }, PROJECT_ID, session.id)).rejects.toThrow(FullPreviewNotFoundError);
  });

  it("both refuse a session that exists but belongs to a DIFFERENT project - never confirms it exists elsewhere", async () => {
    const { executionSessionRepository, fullPreviewArtifactRepository, assetStorage, session } = await setup();
    await expect(getFullPreviewMetadata({ executionSessionRepository, fullPreviewArtifactRepository }, OTHER_PROJECT_ID, session.id)).rejects.toThrow(ExecutionSessionNotFoundError);
    await expect(getFullPreviewFile({ executionSessionRepository, fullPreviewArtifactRepository, assetStorage }, OTHER_PROJECT_ID, session.id)).rejects.toThrow(ExecutionSessionNotFoundError);
  });

  it("returns the real bytes and metadata for a genuinely captured artifact, scoped to the correct project", async () => {
    const { executionSessionRepository, fullPreviewArtifactRepository, assetStorage, session } = await setup();
    const stored = await assetStorage.store({ projectId: PROJECT_ID, buffer: Buffer.from("real preview bytes"), extension: "mp4" });
    await fullPreviewArtifactRepository.record(
      {
        id: randomUUID(),
        projectId: PROJECT_ID,
        executionSessionId: session.id,
        jobId: randomUUID(),
        workingProjectSha256: "d".repeat(64),
        filename: "preview.mp4",
        mimeType: "video/mp4",
        byteSize: stored.byteSize,
        storageKey: stored.storageKey,
        sha256: stored.sha256,
        capturedAt: NOW
      },
      NOW
    );

    const metadata = await getFullPreviewMetadata({ executionSessionRepository, fullPreviewArtifactRepository }, PROJECT_ID, session.id);
    expect(metadata?.mimeType).toBe("video/mp4");
    expect(metadata?.projectId).toBe(PROJECT_ID);

    const file = await getFullPreviewFile({ executionSessionRepository, fullPreviewArtifactRepository, assetStorage }, PROJECT_ID, session.id);
    expect(file.mimeType).toBe("video/mp4");
    expect(file.buffer.toString()).toBe("real preview bytes");
  });
});
