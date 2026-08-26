import type { AssetDto, UpdateAssetRequest } from "@dyo/schemas";
import { AssetNotFoundError } from "../../errors/app-error.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import { findOwnedAsset } from "./find-owned-asset.js";
import { toAssetDto } from "./asset-dto-mapper.js";

export interface UpdateAssetDeps {
  assetRepository: AssetRepository;
  now: () => Date;
}

/** Only ever label/notes - every other fact is fixed at upload time (see asset.ts's updateAssetRequestSchema). */
export async function updateAsset(
  deps: UpdateAssetDeps,
  projectId: string,
  assetId: string,
  request: UpdateAssetRequest
): Promise<AssetDto> {
  await findOwnedAsset(deps.assetRepository, projectId, assetId);
  const update = {
    ...(request.label !== undefined ? { label: request.label } : {}),
    ...(request.notes !== undefined ? { notes: request.notes } : {})
  };
  const updated = await deps.assetRepository.update(assetId, update, deps.now());
  if (!updated) {
    throw new AssetNotFoundError(assetId);
  }
  return toAssetDto(updated);
}
