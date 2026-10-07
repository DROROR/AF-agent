import type { AssetDto, UpdateAssetRequest } from "@dyo/schemas";
import { AssetNotFoundError, PreconditionNotMetError } from "../../errors/app-error.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import { findOwnedAsset } from "./find-owned-asset.js";
import { toAssetDto } from "./asset-dto-mapper.js";

export interface UpdateAssetDeps {
  assetRepository: AssetRepository;
  now: () => Date;
}

/** Label/notes, and IMAGE <-> LOGO - every other fact is fixed at upload time (see asset.ts's updateAssetRequestSchema). */
export async function updateAsset(
  deps: UpdateAssetDeps,
  projectId: string,
  assetId: string,
  request: UpdateAssetRequest
): Promise<AssetDto> {
  const existing = await findOwnedAsset(deps.assetRepository, projectId, assetId);
  // A still image may be declared the logo, or a logo declared an ordinary
  // picture; nothing else ever changes kind - a video is never a logo.
  if (request.mediaKind !== undefined && existing.mediaKind !== "IMAGE" && existing.mediaKind !== "LOGO") {
    throw new PreconditionNotMetError(`Only a still image can be marked as the logo or as a picture - this file is ${existing.mediaKind.toLowerCase()}`);
  }
  const update = {
    ...(request.label !== undefined ? { label: request.label } : {}),
    ...(request.notes !== undefined ? { notes: request.notes } : {}),
    ...(request.mediaKind !== undefined ? { mediaKind: request.mediaKind } : {})
  };
  const updated = await deps.assetRepository.update(assetId, update, deps.now());
  if (!updated) {
    throw new AssetNotFoundError(assetId);
  }
  return toAssetDto(updated);
}
