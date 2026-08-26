import { DEFAULT_BRAND_INPUTS, type ProjectDto } from "@dyo/schemas";
import type { Project } from "../../domain/project/types.js";

export function toProjectDto(project: Project): ProjectDto {
  return {
    projectId: project.id,
    name: project.name,
    templateId: project.templateId,
    sourceProjectSha256: project.sourceProjectSha256,
    brandInputs: project.brandInputs ?? DEFAULT_BRAND_INPUTS,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
  };
}
