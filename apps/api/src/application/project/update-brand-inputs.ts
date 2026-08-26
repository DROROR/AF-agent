import type { ProjectBrandInputs, ProjectDto } from "@dyo/schemas";
import { ProjectNotFoundError } from "../../errors/app-error.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { toProjectDto } from "./project-dto-mapper.js";

export interface UpdateBrandInputsDeps {
  projectRepository: ProjectRepository;
  now: () => Date;
}

/**
 * Replaces a project's whole brand-inputs object - input only, never
 * executed in After Effects by this phase (see project.ts's own doc
 * comment on why this is distinct from DYO's own permanent brand rules).
 */
export async function updateBrandInputs(
  deps: UpdateBrandInputsDeps,
  projectId: string,
  brandInputs: ProjectBrandInputs
): Promise<ProjectDto> {
  const updated = await deps.projectRepository.updateBrandInputs(projectId, brandInputs, deps.now());
  if (!updated) {
    throw new ProjectNotFoundError(projectId);
  }
  return toProjectDto(updated);
}
