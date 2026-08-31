import { FullPreviewNotFoundError, ExecutionSessionNotFoundError } from "../../errors/app-error.js";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import type { FullPreviewArtifactRepository } from "../../domain/full-preview-artifact/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";

export interface GetFullPreviewFileDeps {
  executionSessionRepository: ExecutionSessionRepository;
  fullPreviewArtifactRepository: FullPreviewArtifactRepository;
  assetStorage: AssetStorage;
}

export interface FullPreviewFile {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Real bytes for authenticated dashboard viewing (client-handoff phase,
 * "real final preview approval gate", section 4) - mirrors
 * get-preview-file.ts's exact project-scoping/AssetStorage pattern.
 * Always the session's LATEST full-preview artifact (never a
 * caller-chosen historical one) - the UI has no use for an old, already-
 * superseded complete preview.
 */
export async function getFullPreviewFile(deps: GetFullPreviewFileDeps, projectId: string, sessionId: string): Promise<FullPreviewFile> {
  const session = await deps.executionSessionRepository.findById(sessionId);
  if (!session || session.projectId !== projectId) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }
  const artifact = await deps.fullPreviewArtifactRepository.findLatestForSession(sessionId);
  if (!artifact) {
    throw new FullPreviewNotFoundError(sessionId);
  }
  const buffer = await deps.assetStorage.read(artifact.storageKey);
  return { buffer, mimeType: artifact.mimeType };
}
