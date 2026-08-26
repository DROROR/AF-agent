import type { AssetDto } from "@dyo/schemas";
import type { AssetRepository } from "../../domain/asset/types.js";
import { findOwnedAsset } from "./find-owned-asset.js";
import { toAssetDto } from "./asset-dto-mapper.js";

export interface GetAssetDeps {
  assetRepository: AssetRepository;
}

export async function getAsset(deps: GetAssetDeps, projectId: string, assetId: string): Promise<AssetDto> {
  const asset = await findOwnedAsset(deps.assetRepository, projectId, assetId);
  return toAssetDto(asset);
}
