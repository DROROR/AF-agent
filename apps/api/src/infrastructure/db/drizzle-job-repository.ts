import { and, desc, eq, sql } from "drizzle-orm";
import { jobs, workers, type Database, type JobRow } from "@dyo/database";
import { TERMINAL_JOB_STATUSES, type JobErrorCode, type JobStatus, type WorkerCapability } from "@dyo/schemas";
import { isJobTerminal } from "../../domain/job/rules.js";
import type { Job, JobRepository, JobStatusUpdate, NewJob } from "../../domain/job/types.js";

const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["CLAIMED", "RUNNING", "WAITING_FOR_ACTION"];

function toDomain(row: JobRow): Job {
  return {
    id: row.id,
    workerId: row.workerId,
    projectId: row.projectId,
    createdByUserId: row.createdByUserId,
    operation: row.operation,
    status: row.status,
    payload: row.payload,
    result: row.result,
    error: row.error as { code: JobErrorCode; message: string } | null,
    checkpoint: row.checkpoint,
    createdAt: row.createdAt,
    claimedAt: row.claimedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt
  };
}

export class DrizzleJobRepository implements JobRepository {
  constructor(private readonly db: Database) {}

  async create(job: NewJob, now: Date): Promise<Job> {
    const [row] = await this.db
      .insert(jobs)
      .values({
        id: job.id,
        workerId: job.workerId,
        projectId: job.projectId ?? null,
        createdByUserId: job.createdByUserId ?? null,
        operation: job.operation,
        payload: job.payload,
        status: "QUEUED",
        createdAt: now,
        updatedAt: now
      })
      .returning();
    if (!row) {
      throw new Error("insert into jobs returned no row");
    }
    return toDomain(row);
  }

  async findById(id: string): Promise<Job | null> {
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, id));
    return row ? toDomain(row) : null;
  }

  /**
   * Atomic, concurrency-limit-aware claim. Locks the worker's row first
   * (SELECT ... FOR UPDATE) so two concurrent claim attempts for the SAME
   * worker serialize rather than both reading a stale active-job count -
   * without this, two simultaneous claims could each observe
   * activeCount < maxConcurrency and both succeed, over-claiming past the
   * limit. FOR UPDATE SKIP LOCKED on the candidate job additionally
   * guarantees two different workers (or a retried request) can never
   * claim the same QUEUED row.
   */
  async claimNextForWorker(workerId: string, maxConcurrency: number, now: Date): Promise<Job | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${workers} where ${workers.id} = ${workerId} for update`);

      const countResult = await tx.execute<{ count: number }>(
        sql`select count(*)::int as count from ${jobs}
            where ${jobs.workerId} = ${workerId} and ${jobs.status} in ${ACTIVE_JOB_STATUSES}`
      );
      const activeCount = countResult.rows[0]?.count ?? 0;
      if (activeCount >= maxConcurrency) {
        return null;
      }

      const candidateResult = await tx.execute<{ id: string }>(
        sql`select id from ${jobs}
            where ${jobs.workerId} = ${workerId} and ${jobs.status} = 'QUEUED'
            order by ${jobs.createdAt} asc
            limit 1
            for update skip locked`
      );
      const candidate = candidateResult.rows[0];
      if (!candidate) {
        return null;
      }

      const [row] = await tx
        .update(jobs)
        .set({ status: "CLAIMED", claimedAt: now, updatedAt: now })
        .where(eq(jobs.id, candidate.id))
        .returning();
      return row ? toDomain(row) : null;
    });
  }

  async updateStatus(jobId: string, workerId: string, update: JobStatusUpdate, now: Date): Promise<Job | null> {
    const [row] = await this.db
      .update(jobs)
      .set({
        status: update.status,
        ...(update.result !== undefined ? { result: update.result } : {}),
        ...(update.error !== undefined ? { error: update.error } : {}),
        ...(update.checkpoint !== undefined ? { checkpoint: update.checkpoint } : {}),
        ...(update.status === "RUNNING" ? { startedAt: sql`coalesce(${jobs.startedAt}, ${now})` } : {}),
        ...(isJobTerminal(update.status) ? { completedAt: now } : {}),
        updatedAt: now
      })
      .where(
        and(eq(jobs.id, jobId), eq(jobs.workerId, workerId), eq(jobs.status, update.expectedCurrentStatus))
      )
      .returning();
    return row ? toDomain(row) : null;
  }

  async updateCheckpoint(jobId: string, workerId: string, checkpoint: unknown, now: Date): Promise<Job | null> {
    const [row] = await this.db
      .update(jobs)
      .set({ checkpoint, updatedAt: now })
      .where(and(eq(jobs.id, jobId), eq(jobs.workerId, workerId), eq(jobs.status, "RUNNING")))
      .returning();
    return row ? toDomain(row) : null;
  }

  async failJobsForStaleWorkers(now: Date, staleAfterMs: number): Promise<string[]> {
    const cutoff = new Date(now.getTime() - staleAfterMs);
    const rows = await this.db
      .update(jobs)
      .set({
        status: "FAILED",
        error: { code: "WORKER_OFFLINE", message: "worker heartbeat went stale while this job was active" },
        completedAt: now,
        updatedAt: now
      })
      .where(
        sql`${jobs.status} in ${ACTIVE_JOB_STATUSES}
            and ${jobs.workerId} in (
              select ${workers.id} from ${workers}
              where ${workers.lastHeartbeatAt} is null or ${workers.lastHeartbeatAt} < ${cutoff}
            )`
      )
      .returning({ id: jobs.id });
    return rows.map((row: { id: string }) => row.id);
  }

  async countActiveForWorker(workerId: string): Promise<number> {
    const result = await this.db.execute<{ count: number }>(
      sql`select count(*)::int as count from ${jobs}
          where ${jobs.workerId} = ${workerId} and ${jobs.status} in ${ACTIVE_JOB_STATUSES}`
    );
    return result.rows[0]?.count ?? 0;
  }

  async hasNonTerminalJobForOperation(workerId: string, operation: WorkerCapability): Promise<boolean> {
    const result = await this.db.execute<{ id: string }>(
      sql`select id from ${jobs}
          where ${jobs.workerId} = ${workerId}
            and ${jobs.operation} = ${operation}
            and ${jobs.status} not in ${TERMINAL_JOB_STATUSES}
          limit 1`
    );
    return result.rows.length > 0;
  }

  async findMostRecentForSessionKey(
    operation: WorkerCapability,
    executionSessionId: string,
    key: "scenePlanId" | "variant",
    value: string
  ): Promise<Job | null> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(
        sql`${jobs.operation} = ${operation}
            and ${jobs.payload} ->> 'executionSessionId' = ${executionSessionId}
            and ${jobs.payload} ->> ${key} = ${value}`
      )
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async listByCreatedByUserId(userId: string, limit: number): Promise<Job[]> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.createdByUserId, userId))
      .orderBy(desc(jobs.createdAt))
      .limit(limit);
    return rows.map(toDomain);
  }

  async hasNonTerminalJobForProject(projectId: string): Promise<boolean> {
    const result = await this.db.execute<{ id: string }>(
      sql`select id from ${jobs}
          where ${jobs.projectId} = ${projectId}
            and ${jobs.status} not in ${TERMINAL_JOB_STATUSES}
          limit 1`
    );
    return result.rows.length > 0;
  }
}
