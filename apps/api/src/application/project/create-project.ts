import { randomUUID } from "node:crypto";
import type { CreateProjectRequest, ProjectDto } from "@dyo/schemas";
import type { ProjectRepository } from "../../domain/project/types.js";
import { toProjectDto } from "./project-dto-mapper.js";

export interface CreateProjectDeps {
  projectRepository: ProjectRepository;
  now: () => Date;
}

/**
 * Promotes one already-produced, schema-valid TemplateManifest (e.g. from
 * a SUCCEEDED INSPECT_TEMPLATE job) into a durable project - the first
 * point anywhere in this system a manifest is persisted beyond a job's
 * own transient result column.
 */
export async function createProject(deps: CreateProjectDeps, request: CreateProjectRequest): Promise<ProjectDto> {
  const project = await deps.projectRepository.create(
    {
      id: randomUUID(),
      name: request.name,
      manifest: request.manifest
    },
    deps.now()
  );
  return toProjectDto(project);
}
