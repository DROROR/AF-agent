import { desc, eq } from "drizzle-orm";
import { executionSessions, type Database, type ExecutionSessionRow } from "@dyo/database";
import type { ExecutionSessionStatus } from "@dyo/schemas";
import type { ExecutionSessionRecord, ExecutionSessionRepository, NewExecutionSession } from "../../domain/execution-session/types.js";

function toDomain(row: ExecutionSessionRow): ExecutionSessionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    executionPlanId: row.executionPlanId,
    planRevision: row.planRevision,
    sourceProjectSha256: row.sourceProjectSha256,
    assignedWorkerId: row.assignedWorkerId,
    status: row.status,
    latestWorkingProjectSha256: row.latestWorkingProjectSha256,
    completedScenePlanIds: row.completedScenePlanIds,
    firstPreviewApproved: row.firstPreviewApproved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class DrizzleExecutionSessionRepository implements ExecutionSessionRepository {
  constructor(private readonly db: Database) {}

  async create(session: NewExecutionSession, now: Date): Promise<ExecutionSessionRecord> {
    const [row] = await this.db
      .insert(executionSessions)
      .values({
        id: session.id,
        projectId: session.projectId,
        executionPlanId: session.executionPlanId,
        planRevision: session.planRevision,
        sourceProjectSha256: session.sourceProjectSha256,
        assignedWorkerId: session.assignedWorkerId,
        status: "PREPARING",
        latestWorkingProjectSha256: null,
        completedScenePlanIds: [],
        firstPreviewApproved: false,
        createdAt: now,
        updatedAt: now
      })
      .returning();
    if (!row) {
      throw new Error("insert into execution_sessions returned no row");
    }
    return toDomain(row);
  }

  async findById(id: string): Promise<ExecutionSessionRecord | null> {
    const [row] = await this.db.select().from(executionSessions).where(eq(executionSessions.id, id));
    return row ? toDomain(row) : null;
  }

  async findLatestByProjectId(projectId: string): Promise<ExecutionSessionRecord | null> {
    const [row] = await this.db
      .select()
      .from(executionSessions)
      .where(eq(executionSessions.projectId, projectId))
      .orderBy(desc(executionSessions.createdAt))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async recordSceneCompleted(
    id: string,
    scenePlanId: string,
    workingProjectSha256: string,
    status: ExecutionSessionStatus,
    now: Date
  ): Promise<ExecutionSessionRecord | null> {
    const [existingRow] = await this.db.select().from(executionSessions).where(eq(executionSessions.id, id));
    if (!existingRow) {
      return null;
    }
    const nextCompleted = existingRow.completedScenePlanIds.includes(scenePlanId)
      ? existingRow.completedScenePlanIds
      : [...existingRow.completedScenePlanIds, scenePlanId];

    const [row] = await this.db
      .update(executionSessions)
      .set({ completedScenePlanIds: nextCompleted, latestWorkingProjectSha256: workingProjectSha256, status, updatedAt: now })
      .where(eq(executionSessions.id, id))
      .returning();
    return row ? toDomain(row) : null;
  }

  async approvePreview(id: string, status: ExecutionSessionStatus, now: Date): Promise<ExecutionSessionRecord | null> {
    const [row] = await this.db
      .update(executionSessions)
      .set({ firstPreviewApproved: true, status, updatedAt: now })
      .where(eq(executionSessions.id, id))
      .returning();
    return row ? toDomain(row) : null;
  }

  async markStatus(id: string, status: ExecutionSessionStatus, now: Date): Promise<ExecutionSessionRecord | null> {
    const [row] = await this.db
      .update(executionSessions)
      .set({ status, updatedAt: now })
      .where(eq(executionSessions.id, id))
      .returning();
    return row ? toDomain(row) : null;
  }
}
