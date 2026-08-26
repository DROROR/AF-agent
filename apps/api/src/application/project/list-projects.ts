import type { ListProjectsResponse } from "@dyo/schemas";
import type { ProjectRepository } from "../../domain/project/types.js";
import { toProjectDto } from "./project-dto-mapper.js";

export interface ListProjectsDeps {
  projectRepository: ProjectRepository;
}

export async function listProjects(deps: ListProjectsDeps): Promise<ListProjectsResponse> {
  const projects = await deps.projectRepository.findAll();
  return { projects: projects.map(toProjectDto) };
}
