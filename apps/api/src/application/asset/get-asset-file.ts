import type { AssetRepository } from "../../domain/asset/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";
import { findOwnedAsset } from "./find-owned-asset.js";

export interface GetAssetFileDeps {
  assetRepository: AssetRepository;
  assetStorage: AssetStorage;
}

export interface AssetFile {
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
}

/** Reads the real bytes back for a preview/download response - the route handler never hands the browser a raw storage key or filesystem path, only these bytes plus the real mimeType. */
export async function getAssetFile(deps: GetAssetFileDeps, projectId: string, assetId: string): Promise<AssetFile> {
  const asset = await findOwnedAsset(deps.assetRepository, projectId, assetId);
  const buffer = await deps.assetStorage.read(asset.storageKey);
  return { buffer, mimeType: asset.mimeType, originalFilename: asset.originalFilename };
}
