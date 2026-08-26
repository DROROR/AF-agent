import type { ProjectResponse } from "@dyo/schemas";
import { ProjectNotFoundError } from "../../errors/app-error.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { toProjectDto } from "./project-dto-mapper.js";

export interface GetProjectDeps {
  projectRepository: ProjectRepository;
}

export async function getProject(deps: GetProjectDeps, projectId: string): Promise<ProjectResponse> {
  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }
  return { project: toProjectDto(project), manifest: project.manifest };
}
