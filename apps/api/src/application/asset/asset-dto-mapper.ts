import type { AssetDto } from "@dyo/schemas";
import type { AssetRecord } from "../../domain/asset/types.js";

export function toAssetDto(record: AssetRecord): AssetDto {
  return {
    id: record.id,
    projectId: record.projectId,
    originalFilename: record.originalFilename,
    storageKey: record.storageKey,
    mediaKind: record.mediaKind,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    sha256: record.sha256,
    width: record.width,
    hasAlphaChannel: record.hasAlphaChannel,
    hasTransparentPixels: record.hasTransparentPixels,
    transparentPixelRatio: record.transparentPixelRatio,
    visibleCoverageRatio: record.visibleCoverageRatio,
    visibleContentBounds: record.visibleContentBounds,
    height: record.height,
    durationSeconds: record.durationSeconds,
    label: record.label,
    notes: record.notes,
    uploadedAt: record.uploadedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}
