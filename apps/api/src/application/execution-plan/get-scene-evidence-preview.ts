import type { SceneEvidencePreviewDto } from "@dyo/schemas";
import { ExecutionPlanNotFoundError, SceneEvidencePreviewNotFoundError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { SceneEvidencePreviewRepository } from "../../domain/scene-evidence-preview/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";

export interface GetSceneEvidencePreviewDeps {
  executionPlanRepository: ExecutionPlanRepository;
  sceneEvidencePreviewRepository: SceneEvidencePreviewRepository;
}

function toDto(record: {
  id: string;
  projectId: string;
  manifestCompositionId: string;
  sourceProjectSha256: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  capturedAt: Date;
  capturedAtSeconds: number | null;
  slotMappingId: string | null;
  createdAt: Date;
}): SceneEvidencePreviewDto {
  return {
    id: record.id,
    projectId: record.projectId,
    manifestCompositionId: record.manifestCompositionId,
    sourceProjectSha256: record.sourceProjectSha256,
    filename: record.filename,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    capturedAt: record.capturedAt.toISOString(),
    capturedAtSeconds: record.capturedAtSeconds,
    storageKey: record.storageKey,
    slotMappingId: record.slotMappingId,
    createdAt: record.createdAt.toISOString()
  };
}

async function resolveManifestCompositionId(deps: GetSceneEvidencePreviewDeps, projectId: string, scenePlanId: string): Promise<string> {
  const plan = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (!plan) {
    throw new ExecutionPlanNotFoundError(projectId);
  }
  const scene = plan.scenePlans.find((s) => s.id === scenePlanId);
  if (!scene) {
    throw new ExecutionPlanNotFoundError(projectId);
  }
  return scene.manifestCompositionId;
}

/**
 * GET .../scenes/:scenePlanId/preview-status (client-facing UX redesign,
 * "M. VISUAL PREVIEWS ARE MANDATORY") - metadata only. null when no
 * preview has ever been captured for this scene's composition yet - a
 * real, valid state ("Preview generating..." vs "Ready" is decided by the
 * caller from this plus the live job status), never an error.
 *
 * `mappingId` asks for THAT SLOT's own current frame instead of the scene's
 * latest (real 2026-09-24 defect - see update-execution-plan.ts's own comment
 * and docs/ACCEPTANCE.md). A reviewer deciding about one slot must be shown,
 * and must name, the frame captured for THAT slot - with several slots being
 * reviewed in one pass, the scene's newest frame belongs to whichever slot was
 * captured last and is the wrong answer for every other one. Omitted keeps the
 * exact prior behavior for every existing caller.
 */
export async function getSceneEvidencePreviewMetadata(
  deps: GetSceneEvidencePreviewDeps,
  projectId: string,
  scenePlanId: string,
  mappingId?: string
): Promise<SceneEvidencePreviewDto | null> {
  const manifestCompositionId = await resolveManifestCompositionId(deps, projectId, scenePlanId);
  const record =
    mappingId === undefined
      ? await deps.sceneEvidencePreviewRepository.findLatestForComposition(projectId, manifestCompositionId)
      : await deps.sceneEvidencePreviewRepository.findLatestForSlot(projectId, manifestCompositionId, mappingId);
  return record ? toDto(record) : null;
}

export interface SceneEvidencePreviewFile {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Real bytes for authenticated dashboard viewing - mirrors
 * get-full-preview-file.ts's exact project-scoping/AssetStorage pattern.
 * Always the LATEST preview (never a caller-chosen historical one) - of the
 * composition, or, when `mappingId` names one, of that slot, exactly as
 * getSceneEvidencePreviewMetadata above resolves it.
 */
export async function getSceneEvidencePreviewFile(
  deps: GetSceneEvidencePreviewDeps & { assetStorage: AssetStorage },
  projectId: string,
  scenePlanId: string,
  mappingId?: string
): Promise<SceneEvidencePreviewFile> {
  const manifestCompositionId = await resolveManifestCompositionId(deps, projectId, scenePlanId);
  const record =
    mappingId === undefined
      ? await deps.sceneEvidencePreviewRepository.findLatestForComposition(projectId, manifestCompositionId)
      : await deps.sceneEvidencePreviewRepository.findLatestForSlot(projectId, manifestCompositionId, mappingId);
  if (!record) {
    throw new SceneEvidencePreviewNotFoundError(scenePlanId);
  }
  const buffer = await deps.assetStorage.read(record.storageKey);
  return { buffer, mimeType: record.mimeType };
}
