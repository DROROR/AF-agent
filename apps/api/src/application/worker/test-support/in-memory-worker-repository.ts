import type {
  NewWorker,
  Worker,
  WorkerHeartbeatUpdate,
  WorkerRepository
} from "../../../domain/worker/types.js";
import { isHeartbeatStale } from "../../../domain/worker/rules.js";

/** In-memory fake used only by unit tests - never imported from production code. */
export class InMemoryWorkerRepository implements WorkerRepository {
  private readonly rows = new Map<string, Worker>();

  async create(worker: NewWorker, now: Date): Promise<Worker> {
    const row: Worker = {
      id: worker.id,
      name: worker.name,
      tokenHash: worker.tokenHash,
      status: "OFFLINE",
      aeStatus: "UNKNOWN",
      mcpStatus: "UNKNOWN",
      aeVersion: null,
      capabilities: worker.capabilities,
      maxConcurrency: worker.maxConcurrency,
      currentJobId: null,
      lastHeartbeatAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findById(id: string): Promise<Worker | null> {
    return this.rows.get(id) ?? null;
  }

  async findAll(): Promise<Worker[]> {
    return [...this.rows.values()];
  }

  async updateHeartbeat(
    id: string,
    update: WorkerHeartbeatUpdate,
    now: Date
  ): Promise<Worker | null> {
    const existing = this.rows.get(id);
    if (!existing) {
      return null;
    }
    const updated: Worker = {
      ...existing,
      status: "ONLINE",
      aeStatus: update.aeStatus,
      mcpStatus: update.mcpStatus,
      aeVersion: update.aeVersion,
      capabilities: update.capabilities ?? existing.capabilities,
      maxConcurrency: update.maxConcurrency ?? existing.maxConcurrency,
      currentJobId: update.currentJobId,
      lastHeartbeatAt: now,
      updatedAt: now
    };
    this.rows.set(id, updated);
    return updated;
  }

  async markStaleWorkersOffline(now: Date, staleAfterMs: number): Promise<string[]> {
    const affected: string[] = [];
    for (const worker of this.rows.values()) {
      if (worker.status === "ONLINE" && isHeartbeatStale(worker.lastHeartbeatAt, now, staleAfterMs)) {
        this.rows.set(worker.id, { ...worker, status: "OFFLINE", updatedAt: now });
        affected.push(worker.id);
      }
    }
    return affected;
  }
}
