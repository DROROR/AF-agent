import { ExecutionSessionNotFoundError, PreviewNotFoundError } from "../../errors/app-error.js";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";

export interface GetPreviewFileDeps {
  executionSessionRepository: ExecutionSessionRepository;
  assetStorage: AssetStorage;
}

export interface PreviewFile {
  buffer: Buffer;
  mimeType: string;
}

const PREVIEW_MIME_TYPE = "image/png";

/**
 * Real bytes for authenticated dashboard viewing (multi-scene-accumulation
 * phase, section 3: "authenticated project-scoped image fetch -> image
 * visibly rendered in dashboard") - reads via the SAME AssetStorage
 * abstraction previews are uploaded through (upload-preview.ts), never a
 * raw filesystem path. Cross-project access is refused identically to
 * "not found at all" - a sessionId that exists under a DIFFERENT project
 * is never confirmed to exist (mirrors get-render-artifact-file.ts).
 */
export async function getPreviewFile(deps: GetPreviewFileDeps, projectId: string, sessionId: string): Promise<PreviewFile> {
  const session = await deps.executionSessionRepository.findById(sessionId);
  if (!session || session.projectId !== projectId) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }
  if (!session.latestPreviewStorageKey) {
    throw new PreviewNotFoundError(sessionId);
  }
  const buffer = await deps.assetStorage.read(session.latestPreviewStorageKey);
  return { buffer, mimeType: PREVIEW_MIME_TYPE };
}
