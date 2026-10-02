import { eq } from "drizzle-orm";
import { projects, type Database, type ProjectRow } from "@dyo/database";
import { projectBrandInputsSchema } from "@dyo/schemas";
import type { NewProject, Project, ProjectRepository } from "../../domain/project/types.js";

/**
 * `brand_inputs` is a jsonb column, so drizzle's `$type<ProjectBrandInputs>()`
 * is a compile-time claim about data the database never validated. Every row
 * written before 2026-10-02 has no `websiteUrl` key at all, and reading one
 * straight through would hand the rest of the application `undefined` where
 * it is typed `string | null`.
 *
 * Parsing through the schema applies its own documented default instead. A
 * row that genuinely does not match the contract is reported as absent rather
 * than passed on half-valid - the same rule the rest of this codebase
 * follows for state it cannot verify.
 */
function toBrandInputs(raw: ProjectRow["brandInputs"]): Project["brandInputs"] {
  if (raw == null) {
    return null;
  }
  const parsed = projectBrandInputsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function toDomain(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    templateId: row.templateId,
    sourceProjectSha256: row.sourceProjectSha256,
    manifest: row.manifest,
    brandInputs: toBrandInputs(row.brandInputs),
    sourceWorkerId: row.sourceWorkerId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly db: Database) {}

  async create(project: NewProject, now: Date): Promise<Project> {
    const [row] = await this.db
      .insert(projects)
      .values({
        id: project.id,
        name: project.name,
        // Derived from the manifest itself, never passed separately - a
        // single source of truth so these indexed columns can never drift
        // from what the stored manifest actually says.
        templateId: project.manifest.templateId,
        sourceProjectSha256: project.manifest.sourceProject.sha256,
        manifest: project.manifest,
        brandInputs: null,
        sourceWorkerId: project.sourceWorkerId ?? null,
        createdAt: now,
        updatedAt: now
      })
      .returning();
    if (!row) {
      throw new Error("insert into projects returned no row");
    }
    return toDomain(row);
  }

  async findById(id: string): Promise<Project | null> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id));
    return row ? toDomain(row) : null;
  }

  async findAll(): Promise<Project[]> {
    const rows = await this.db.select().from(projects).orderBy(projects.createdAt);
    return rows.map(toDomain);
  }

  async updateManifest(id: string, manifest: Project["manifest"], now: Date): Promise<Project | null> {
    const [row] = await this.db
      .update(projects)
      .set({
        templateId: manifest.templateId,
        sourceProjectSha256: manifest.sourceProject.sha256,
        manifest,
        updatedAt: now
      })
      .where(eq(projects.id, id))
      .returning();
    return row ? toDomain(row) : null;
  }

  async updateBrandInputs(id: string, brandInputs: Project["brandInputs"], now: Date): Promise<Project | null> {
    const [row] = await this.db.update(projects).set({ brandInputs, updatedAt: now }).where(eq(projects.id, id)).returning();
    return row ? toDomain(row) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }
}
