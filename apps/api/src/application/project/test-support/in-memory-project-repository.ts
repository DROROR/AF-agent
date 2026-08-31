import type { NewProject, Project, ProjectRepository } from "../../../domain/project/types.js";

/** In-memory fake used only by unit tests - never imported from production code. */
export class InMemoryProjectRepository implements ProjectRepository {
  private readonly rows = new Map<string, Project>();

  async create(project: NewProject, now: Date): Promise<Project> {
    const row: Project = {
      id: project.id,
      name: project.name,
      templateId: project.manifest.templateId,
      sourceProjectSha256: project.manifest.sourceProject.sha256,
      manifest: project.manifest,
      brandInputs: null,
      createdAt: now,
      updatedAt: now
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findById(id: string): Promise<Project | null> {
    return this.rows.get(id) ?? null;
  }

  async findAll(): Promise<Project[]> {
    return [...this.rows.values()];
  }

  async updateManifest(id: string, manifest: Project["manifest"], now: Date): Promise<Project | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const updated: Project = {
      ...existing,
      templateId: manifest.templateId,
      sourceProjectSha256: manifest.sourceProject.sha256,
      manifest,
      updatedAt: now
    };
    this.rows.set(id, updated);
    return updated;
  }

  async updateBrandInputs(id: string, brandInputs: Project["brandInputs"], now: Date): Promise<Project | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const updated: Project = { ...existing, brandInputs, updatedAt: now };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
