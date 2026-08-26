import type { TemplateManifest } from "@dyo/schemas";

export interface Project {
  id: string;
  name: string;
  templateId: string;
  sourceProjectSha256: string;
  manifest: TemplateManifest;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProject {
  id: string;
  name: string;
  manifest: TemplateManifest;
}

/**
 * Port the application layer depends on - see docs/engineering/CODE_STANDARDS.md's
 * dependency direction (route -> application -> domain -> repository), same
 * pattern as domain/job/types.ts's JobRepository.
 */
export interface ProjectRepository {
  create(project: NewProject, now: Date): Promise<Project>;
  findById(id: string): Promise<Project | null>;
  findAll(): Promise<Project[]>;
  /**
   * Replaces a project's manifest in place (e.g. the client fixed
   * something and re-ran INSPECT_TEMPLATE) - templateId/sourceProjectSha256
   * are re-derived from the new manifest, same as create(). This is what
   * makes an execution plan's own sourceProjectSha256 binding meaningful:
   * a plan built against the OLD manifest must be checked against
   * whatever the project's CURRENT manifest says at approval time.
   */
  updateManifest(id: string, manifest: Project["manifest"], now: Date): Promise<Project | null>;
}
