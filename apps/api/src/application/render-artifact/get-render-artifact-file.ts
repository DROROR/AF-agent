import { RenderArtifactNotFoundError } from "../../errors/app-error.js";
import type { RenderArtifactRepository } from "../../domain/render-artifact/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";

export interface GetRenderArtifactFileDeps {
  renderArtifactRepository: RenderArtifactRepository;
  assetStorage: AssetStorage;
}

export interface RenderArtifactFile {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

/**
 * Real bytes for authenticated download (render-delivery phase section 6)
 * - reads via the SAME AssetStorage abstraction render artifacts are
 * uploaded through (upload-render-artifact.ts), never a raw filesystem
 * path. Cross-project access is refused identically to "not found at
 * all" (findByIdForProject already enforces this - never confirms an
 * artifact exists under a different project).
 */
export async function getRenderArtifactFile(
  deps: GetRenderArtifactFileDeps,
  projectId: string,
  artifactId: string
): Promise<RenderArtifactFile> {
  const artifact = await deps.renderArtifactRepository.findByIdForProject(artifactId, projectId);
  if (!artifact) {
    throw new RenderArtifactNotFoundError(artifactId);
  }
  const buffer = await deps.assetStorage.read(artifact.storageKey);
  return { buffer, mimeType: artifact.mimeType, filename: artifact.filename };
}
