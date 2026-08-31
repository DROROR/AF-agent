import { ProjectHasActiveJobError, ProjectNotFoundError } from "../../errors/app-error.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import type { RenderArtifactRepository } from "../../domain/render-artifact/types.js";
import type { RenderArtifactUploadRepository } from "../../domain/render-artifact-upload/types.js";

export interface DeleteProjectDeps {
  projectRepository: ProjectRepository;
  jobRepository: JobRepository;
  assetRepository: AssetRepository;
  assetStorage: AssetStorage;
  executionSessionRepository: ExecutionSessionRepository;
  renderArtifactRepository: RenderArtifactRepository;
  renderArtifactUploadRepository: RenderArtifactUploadRepository;
}

/**
 * Offline-safe-control-plane phase, section 1 ("Add Delete Project").
 * Refuses while any job for this project is still non-terminal (see
 * ProjectHasActiveJobError's own doc comment), then deletes every real
 * AssetStorage object this project owns - assets, execution-session
 * previews, render artifacts, and any render-artifact upload that never
 * made it into a recorded artifact - BEFORE deleting the project row
 * itself, same ordering rule as delete-asset.ts ("a DB cascade cannot
 * also delete a file on disk").
 *
 * Never touches the Windows worker's own filesystem: the original client
 * .aep is never copied into DYO's AssetStorage in the first place (only
 * its path/sha256 live in the project's own manifest jsonb) - there is no
 * "original .aep" for this function to ever delete, by construction, not
 * merely by omission.
 *
 * The project row's DB delete cascades (ON DELETE CASCADE) to every
 * project-scoped table - assets, work maps, execution plans/sessions,
 * mapping suggestions, scene evidence, render artifacts/uploads, jobs -
 * see packages/database/src/schema.ts. Storage keys are collected into a
 * Set first (some legitimately overlap, e.g. a render_artifacts row's
 * storageKey is always the same object as its matching
 * render_artifact_uploads row - see record-render-artifact.ts) so a
 * shared object is never handed to AssetStorage.delete more than once,
 * though that call is itself idempotent/never throws for a missing file
 * either way.
 */
export async function deleteProject(deps: DeleteProjectDeps, projectId: string): Promise<void> {
  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  const hasActiveJob = await deps.jobRepository.hasNonTerminalJobForProject(projectId);
  if (hasActiveJob) {
    throw new ProjectHasActiveJobError(projectId);
  }

  const storageKeys = new Set<string>();

  const assets = await deps.assetRepository.listByProjectId(projectId);
  for (const asset of assets) {
    storageKeys.add(asset.storageKey);
  }

  const sessions = await deps.executionSessionRepository.listByProjectId(projectId);
  for (const session of sessions) {
    if (session.latestPreviewStorageKey) {
      storageKeys.add(session.latestPreviewStorageKey);
    }
  }

  const artifacts = await deps.renderArtifactRepository.listByProject(projectId);
  for (const artifact of artifacts) {
    storageKeys.add(artifact.storageKey);
  }

  const uploads = await deps.renderArtifactUploadRepository.listByProjectId(projectId);
  for (const upload of uploads) {
    storageKeys.add(upload.storageKey);
  }

  await deps.projectRepository.delete(projectId);

  for (const storageKey of storageKeys) {
    await deps.assetStorage.delete(storageKey);
  }
}
