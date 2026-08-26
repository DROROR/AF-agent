import { AssetCrossProjectAccessError, AssetNotFoundError } from "../../errors/app-error.js";
import type { AssetRecord, AssetRepository } from "../../domain/asset/types.js";

/**
 * Single shared ownership check reused by get/update/delete/file-download
 * - an asset that exists but belongs to a DIFFERENT project is refused
 * exactly like one that doesn't exist at all (both surface as the same
 * ASSET_NOT_FOUND/404 to the caller - never confirm to an operator that
 * an asset id they don't own exists somewhere else).
 */
export async function findOwnedAsset(assetRepository: AssetRepository, projectId: string, assetId: string): Promise<AssetRecord> {
  const asset = await assetRepository.findById(assetId);
  if (!asset) {
    throw new AssetNotFoundError(assetId);
  }
  if (asset.projectId !== projectId) {
    throw new AssetCrossProjectAccessError(assetId, projectId);
  }
  return asset;
}
