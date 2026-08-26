import type { AssetDto } from "@dyo/schemas";
import { ProjectNotFoundError } from "../../errors/app-error.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { toAssetDto } from "./asset-dto-mapper.js";

export interface ListAssetsDeps {
  assetRepository: AssetRepository;
  projectRepository: ProjectRepository;
}

export async function listAssets(deps: ListAssetsDeps, projectId: string): Promise<AssetDto[]> {
  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }
  const records = await deps.assetRepository.listByProjectId(projectId);
  return records.map(toAssetDto);
}
