import type { RenderArtifactDto } from "@dyo/schemas";
import { ProjectNotFoundError } from "../../errors/app-error.js";
import type { RenderArtifactRepository } from "../../domain/render-artifact/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { toRenderArtifactDto } from "./render-artifact-dto-mapper.js";

export interface ListRenderArtifactsDeps {
  renderArtifactRepository: RenderArtifactRepository;
  projectRepository: ProjectRepository;
}

export async function listRenderArtifacts(deps: ListRenderArtifactsDeps, projectId: string): Promise<RenderArtifactDto[]> {
  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }
  const records = await deps.renderArtifactRepository.listByProject(projectId);
  return records.map(toRenderArtifactDto);
}
