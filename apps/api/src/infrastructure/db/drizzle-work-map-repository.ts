import { desc, eq } from "drizzle-orm";
import { projectWorkMaps, type Database, type ProjectWorkMapRow } from "@dyo/database";
import type { NewWorkMapRevision, WorkMapRecord, WorkMapRepository } from "../../domain/work-map/types.js";

function toDomain(row: ProjectWorkMapRow): WorkMapRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    revision: row.revision,
    entries: row.entries,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class DrizzleWorkMapRepository implements WorkMapRepository {
  constructor(private readonly db: Database) {}

  async createRevision(revisionRow: NewWorkMapRevision, now: Date): Promise<WorkMapRecord> {
    const [row] = await this.db
      .insert(projectWorkMaps)
      .values({
        id: revisionRow.id,
        projectId: revisionRow.projectId,
        revision: revisionRow.revision,
        entries: revisionRow.entries,
        createdAt: now,
        updatedAt: now
      })
      .returning();
    if (!row) {
      throw new Error("insert into project_work_maps returned no row");
    }
    return toDomain(row);
  }

  async findCurrentByProjectId(projectId: string): Promise<WorkMapRecord | null> {
    const [row] = await this.db
      .select()
      .from(projectWorkMaps)
      .where(eq(projectWorkMaps.projectId, projectId))
      .orderBy(desc(projectWorkMaps.revision))
      .limit(1);
    return row ? toDomain(row) : null;
  }
}
