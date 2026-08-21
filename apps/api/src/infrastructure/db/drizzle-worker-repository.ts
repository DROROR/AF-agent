import { and, eq, isNull, lt, or } from "drizzle-orm";
import { workers, type Database, type WorkerRow } from "@dyo/database";
import type {
  NewWorker,
  Worker,
  WorkerHeartbeatUpdate,
  WorkerRepository
} from "../../domain/worker/types.js";

function toDomain(row: WorkerRow): Worker {
  return {
    id: row.id,
    name: row.name,
    tokenHash: row.tokenHash,
    status: row.status,
    aeStatus: row.aeStatus,
    mcpStatus: row.mcpStatus,
    aeVersion: row.aeVersion,
    capabilities: row.capabilities,
    maxConcurrency: row.maxConcurrency,
    currentJobId: row.currentJobId,
    lastHeartbeatAt: row.lastHeartbeatAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class DrizzleWorkerRepository implements WorkerRepository {
  constructor(private readonly db: Database) {}

  async create(worker: NewWorker, now: Date): Promise<Worker> {
    const [row] = await this.db
      .insert(workers)
      .values({
        id: worker.id,
        name: worker.name,
        tokenHash: worker.tokenHash,
        maxConcurrency: worker.maxConcurrency,
        capabilities: worker.capabilities,
        status: "OFFLINE",
        aeStatus: "UNKNOWN",
        mcpStatus: "UNKNOWN",
        currentJobId: null,
        lastHeartbeatAt: null,
        createdAt: now,
        updatedAt: now
      })
      .returning();
    if (!row) {
      throw new Error("insert into workers returned no row");
    }
    return toDomain(row);
  }

  async findById(id: string): Promise<Worker | null> {
    const [row] = await this.db.select().from(workers).where(eq(workers.id, id));
    return row ? toDomain(row) : null;
  }

  async findAll(): Promise<Worker[]> {
    const rows = await this.db.select().from(workers).orderBy(workers.createdAt);
    return rows.map(toDomain);
  }

  async updateHeartbeat(
    id: string,
    update: WorkerHeartbeatUpdate,
    now: Date
  ): Promise<Worker | null> {
    const [row] = await this.db
      .update(workers)
      .set({
        status: "ONLINE",
        aeStatus: update.aeStatus,
        mcpStatus: update.mcpStatus,
        aeVersion: update.aeVersion,
        currentJobId: update.currentJobId,
        ...(update.capabilities ? { capabilities: update.capabilities } : {}),
        ...(update.maxConcurrency ? { maxConcurrency: update.maxConcurrency } : {}),
        lastHeartbeatAt: now,
        updatedAt: now
      })
      .where(eq(workers.id, id))
      .returning();
    return row ? toDomain(row) : null;
  }

  async markStaleWorkersOffline(now: Date, staleAfterMs: number): Promise<string[]> {
    const cutoff = new Date(now.getTime() - staleAfterMs);
    const rows = await this.db
      .update(workers)
      .set({ status: "OFFLINE", updatedAt: now })
      .where(
        and(
          eq(workers.status, "ONLINE"),
          or(isNull(workers.lastHeartbeatAt), lt(workers.lastHeartbeatAt, cutoff))
        )
      )
      .returning({ id: workers.id });
    return rows.map((row: { id: string }) => row.id);
  }
}
