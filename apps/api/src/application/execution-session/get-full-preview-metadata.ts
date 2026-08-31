import type { FullPreviewArtifactDto } from "@dyo/schemas";
import { ExecutionSessionNotFoundError } from "../../errors/app-error.js";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import type { FullPreviewArtifactRepository } from "../../domain/full-preview-artifact/types.js";

export interface GetFullPreviewMetadataDeps {
  executionSessionRepository: ExecutionSessionRepository;
  fullPreviewArtifactRepository: FullPreviewArtifactRepository;
}

/**
 * GET .../execution-sessions/:sessionId/full-preview-status (client-
 * handoff phase, "real final preview approval gate") - metadata only
 * (see execution-sessions.ts's own GET .../full-preview route for the
 * real bytes). null when no full-preview artifact has ever been captured
 * for this session yet - a real, valid state, never an error.
 */
export async function getFullPreviewMetadata(deps: GetFullPreviewMetadataDeps, projectId: string, sessionId: string): Promise<FullPreviewArtifactDto | null> {
  const session = await deps.executionSessionRepository.findById(sessionId);
  if (!session || session.projectId !== projectId) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }
  const artifact = await deps.fullPreviewArtifactRepository.findLatestForSession(sessionId);
  if (!artifact) {
    return null;
  }
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    executionSessionId: artifact.executionSessionId,
    workingProjectSha256: artifact.workingProjectSha256,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    byteSize: artifact.byteSize,
    capturedAt: artifact.capturedAt.toISOString(),
    createdAt: artifact.createdAt.toISOString()
  };
}
