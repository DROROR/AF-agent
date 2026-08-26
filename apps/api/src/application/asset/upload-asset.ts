import { randomUUID } from "node:crypto";
import type { AssetDto, MediaKind } from "@dyo/schemas";
import { PayloadTooLargeError, ProjectNotFoundError, UnsupportedMediaTypeError } from "../../errors/app-error.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import type { AssetStorage } from "../../domain/asset-storage/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { extensionForMime, resolveMediaKindForUpload } from "../../domain/asset/mime-allowlist.js";
import { toAssetDto } from "./asset-dto-mapper.js";

export interface UploadAssetDeps {
  assetRepository: AssetRepository;
  assetStorage: AssetStorage;
  projectRepository: ProjectRepository;
  maxUploadBytes: number;
  now: () => Date;
}

export interface UploadAssetInput {
  /** Kept only as display metadata (see asset.ts's own doc comment) - never used to build a storage path. */
  originalFilename: string;
  mimeType: string;
  buffer: Buffer;
  /** Explicit user label at upload time - the only semantic override this system accepts (see mime-allowlist.ts). */
  requestedMediaKind: MediaKind | null;
}

/**
 * Real upload flow: validate project ownership and limits BEFORE ever
 * writing a byte, compute the real sha256 server-side from the actual
 * written bytes (see AssetStorage.store), and only persist metadata once
 * storage has genuinely succeeded - if the metadata insert then fails for
 * any reason, the just-written file is cleaned up rather than left
 * orphaned (section 5: "clean partial file on failure").
 */
export async function uploadAsset(deps: UploadAssetDeps, projectId: string, input: UploadAssetInput): Promise<AssetDto> {
  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  if (input.buffer.length > deps.maxUploadBytes) {
    throw new PayloadTooLargeError(deps.maxUploadBytes);
  }

  const resolved = resolveMediaKindForUpload(input.mimeType, input.requestedMediaKind);
  if (!resolved.ok) {
    throw new UnsupportedMediaTypeError(resolved.reason);
  }
  const extension = extensionForMime(input.mimeType);
  if (!extension) {
    throw new UnsupportedMediaTypeError(`Unsupported file type: ${input.mimeType}`);
  }

  const stored = await deps.assetStorage.store({ projectId, buffer: input.buffer, extension });

  try {
    const record = await deps.assetRepository.create(
      {
        id: randomUUID(),
        projectId,
        originalFilename: input.originalFilename,
        storageKey: stored.storageKey,
        mediaKind: resolved.mediaKind,
        mimeType: input.mimeType,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        width: null,
        height: null,
        durationSeconds: null,
        label: null,
        notes: null
      },
      deps.now()
    );
    return toAssetDto(record);
  } catch (error) {
    await deps.assetStorage.delete(stored.storageKey);
    throw error;
  }
}
