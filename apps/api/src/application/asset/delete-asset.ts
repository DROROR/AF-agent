import { AssetInUseError } from "../../errors/app-error.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { findOwnedAsset } from "./find-owned-asset.js";

export interface DeleteAssetDeps {
  assetRepository: AssetRepository;
  assetStorage: AssetStorage;
  executionPlanRepository: ExecutionPlanRepository;
  projectRepository: ProjectRepository;
}

/**
 * Explicit, safe deletion semantics (section 4/12: "if binary deletion
 * semantics are risky, implement explicit safe behavior and document
 * it"): refuses to delete an asset that is still ACTIVE, STRUCTURED
 * project state - either `selectedAssetId` on any mapping in the
 * project's CURRENT execution plan revision, or the project's own
 * `brandInputs.logoAssetId` - rather than either (a) silently deleting
 * the file and leaving a dangling reference a later scene-table/branding
 * view would only surface as a confusing "asset not found", or (b)
 * silently reaching into the execution plan/project record to clear that
 * reference on the asset's own behalf, a cross-domain side effect no
 * caller asked for. The operator must CLEAR_ASSET (or unset the logo)
 * first. The SAME AssetInUseError/409 is reused for both cases rather
 * than inventing a second typed error, since the caller's required
 * recovery action is identical in shape: unmap it elsewhere, then retry.
 *
 * Deliberately does NOT check the Work Map's `desiredAssetId` - per
 * work-map.ts's own contract, a work-map entry is unvalidated user INTENT,
 * never an active, enforced reference (it was never checked to exist even
 * when first saved - see update-work-map.ts). Deleting an asset a work-map
 * entry merely mentions is allowed to proceed; the entry simply becomes a
 * stale piece of client intent, exactly as it would if the id had never
 * been real in the first place. See work-map.test.ts and delete-asset's
 * own tests for the case this intentionally does NOT block.
 *
 * Deletes the DB row before the storage file (not the other way around):
 * if the file delete then fails, the asset is already gone from every
 * API a client can see, and the storage layer's own delete is
 * idempotent/never throws for a missing file, so nothing is left in an
 * inconsistent state either order failed cleanly.
 */
export async function deleteAsset(deps: DeleteAssetDeps, projectId: string, assetId: string): Promise<void> {
  const asset = await findOwnedAsset(deps.assetRepository, projectId, assetId);

  const plan = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  const stillMapped = plan?.scenePlans.some((scene) => scene.mappings.some((mapping) => mapping.selectedAssetId === assetId)) ?? false;
  if (stillMapped) {
    throw new AssetInUseError(assetId);
  }

  const project = await deps.projectRepository.findById(projectId);
  if (project?.brandInputs?.logoAssetId === assetId) {
    throw new AssetInUseError(assetId);
  }

  await deps.assetRepository.delete(assetId);
  await deps.assetStorage.delete(asset.storageKey);
}
