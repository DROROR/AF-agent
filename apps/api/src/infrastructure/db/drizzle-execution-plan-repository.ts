import { and, desc, eq } from "drizzle-orm";
import { executionPlans, type Database, type ExecutionPlanRow } from "@dyo/database";
import type {
  ExecutionPlanRecord,
  ExecutionPlanRepository,
  ExecutionPlanStatusUpdate,
  NewExecutionPlanRevision
} from "../../domain/execution-plan/types.js";

function toDomain(row: ExecutionPlanRow): ExecutionPlanRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    revision: row.revision,
    status: row.status,
    templateId: row.templateId,
    sourceProjectSha256: row.sourceProjectSha256,
    scenePlans: row.scenePlans,
    approvedAt: row.approvedAt,
    approvedBy: row.approvedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class DrizzleExecutionPlanRepository implements ExecutionPlanRepository {
  constructor(private readonly db: Database) {}

  async createRevision(revisionRow: NewExecutionPlanRevision, now: Date): Promise<ExecutionPlanRecord> {
    const [row] = await this.db
      .insert(executionPlans)
      .values({
        id: revisionRow.id,
        projectId: revisionRow.projectId,
        revision: revisionRow.revision,
        status: revisionRow.status,
        templateId: revisionRow.templateId,
        sourceProjectSha256: revisionRow.sourceProjectSha256,
        scenePlans: revisionRow.scenePlans,
        approvedAt: revisionRow.approvedAt,
        approvedBy: revisionRow.approvedBy,
        createdAt: now,
        updatedAt: now
      })
      .returning();
    if (!row) {
      throw new Error("insert into execution_plans returned no row");
    }
    return toDomain(row);
  }

  async findCurrentByProjectId(projectId: string): Promise<ExecutionPlanRecord | null> {
    const [row] = await this.db
      .select()
      .from(executionPlans)
      .where(eq(executionPlans.projectId, projectId))
      .orderBy(desc(executionPlans.revision))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async updateStatus(
    id: string,
    expectedRevision: number,
    update: ExecutionPlanStatusUpdate,
    now: Date
  ): Promise<ExecutionPlanRecord | null> {
    const [row] = await this.db
      .update(executionPlans)
      .set({ status: update.status, approvedAt: update.approvedAt, approvedBy: update.approvedBy, updatedAt: now })
      .where(and(eq(executionPlans.id, id), eq(executionPlans.revision, expectedRevision)))
      .returning();
    return row ? toDomain(row) : null;
  }
}
