import type { ProjectBrandInputs, TemplateManifest } from "@dyo/schemas";

export interface Project {
  id: string;
  name: string;
  templateId: string;
  sourceProjectSha256: string;
  manifest: TemplateManifest;
  /** Null until a human sets it - the application layer maps this to DEFAULT_BRAND_INPUTS at the DTO boundary rather than every repository having to know that default. */
  brandInputs: ProjectBrandInputs | null;
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
  /** Replaces the whole brand-inputs object in place - never revisioned (this is small, single-value project configuration, not a plan/work-map history). */
  updateBrandInputs(id: string, brandInputs: ProjectBrandInputs, now: Date): Promise<Project | null>;
  /**
   * Deletes the project row - cascades (ON DELETE CASCADE) to every
   * project-scoped table (assets, work maps, execution plans/sessions,
   * mapping suggestions, scene evidence, render artifacts/uploads, jobs -
   * see packages/database/src/schema.ts). Never deletes a real storage
   * file itself - the application layer (delete-project.ts) must collect
   * and delete every owned AssetStorage object BEFORE calling this, same
   * ordering rule as delete-asset.ts. A no-op (never throws) if the
   * project doesn't exist.
   */
  delete(id: string): Promise<void>;
}
