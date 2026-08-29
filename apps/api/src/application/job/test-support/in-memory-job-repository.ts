import type { JobStatus, WorkerCapability } from "@dyo/schemas";
import { canClaimAnotherJob, isJobTerminal } from "../../../domain/job/rules.js";
import type { Job, JobRepository, JobStatusUpdate, NewJob } from "../../../domain/job/types.js";

const ACTIVE_STATUSES: readonly JobStatus[] = ["CLAIMED", "RUNNING", "WAITING_FOR_ACTION"];

/** Minimal shape this fake needs from a worker repository - matches WorkerRepository's relevant part without importing its full interface. */
export interface WorkerHeartbeatLookup {
  findById(id: string): Promise<{ lastHeartbeatAt: Date | null } | null>;
}

/**
 * In-memory fake used only by unit tests - never imported from production
 * code. Mirrors DrizzleJobRepository's compare-and-swap/concurrency
 * semantics without a real database.
 *
 * failJobsForStaleWorkers reads heartbeat freshness from a real
 * WorkerRepository/InMemoryWorkerRepository passed in here (matching how
 * DrizzleJobRepository joins against the real workers table) rather than a
 * separately-populated map - a job whose worker was never told about here
 * defaults to "assume healthy", not "assume stale", so tests that don't
 * care about staleness at all aren't silently affected by it.
 */
export class InMemoryJobRepository implements JobRepository {
  private readonly rows = new Map<string, Job>();

  constructor(private readonly workerRepository?: WorkerHeartbeatLookup) {}

  async create(job: NewJob, now: Date): Promise<Job> {
    const row: Job = {
      id: job.id,
      workerId: job.workerId,
      projectId: job.projectId ?? null,
      createdByUserId: job.createdByUserId ?? null,
      operation: job.operation,
      status: "QUEUED",
      payload: job.payload,
      result: null,
      error: null,
      checkpoint: null,
      createdAt: now,
      claimedAt: null,
      startedAt: null,
      completedAt: null,
      updatedAt: now
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findById(id: string): Promise<Job | null> {
    return this.rows.get(id) ?? null;
  }

  async claimNextForWorker(workerId: string, maxConcurrency: number, now: Date): Promise<Job | null> {
    const activeCount = [...this.rows.values()].filter(
      (job) => job.workerId === workerId && ACTIVE_STATUSES.includes(job.status)
    ).length;
    if (!canClaimAnotherJob(activeCount, maxConcurrency)) {
      return null;
    }

    const candidate = [...this.rows.values()]
      .filter((job) => job.workerId === workerId && job.status === "QUEUED")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!candidate) {
      return null;
    }

    const updated: Job = { ...candidate, status: "CLAIMED", claimedAt: now, updatedAt: now };
    this.rows.set(updated.id, updated);
    return updated;
  }

  async updateStatus(jobId: string, workerId: string, update: JobStatusUpdate, now: Date): Promise<Job | null> {
    const existing = this.rows.get(jobId);
    if (!existing || existing.workerId !== workerId || existing.status !== update.expectedCurrentStatus) {
      return null;
    }
    const updated: Job = {
      ...existing,
      status: update.status,
      ...(update.result !== undefined ? { result: update.result } : {}),
      ...(update.error !== undefined ? { error: update.error } : {}),
      ...(update.checkpoint !== undefined ? { checkpoint: update.checkpoint } : {}),
      ...(update.status === "RUNNING" && !existing.startedAt ? { startedAt: now } : {}),
      ...(isJobTerminal(update.status) ? { completedAt: now } : {}),
      updatedAt: now
    };
    this.rows.set(jobId, updated);
    return updated;
  }

  async updateCheckpoint(jobId: string, workerId: string, checkpoint: unknown, now: Date): Promise<Job | null> {
    const existing = this.rows.get(jobId);
    if (!existing || existing.workerId !== workerId || existing.status !== "RUNNING") {
      return null;
    }
    const updated: Job = { ...existing, checkpoint, updatedAt: now };
    this.rows.set(jobId, updated);
    return updated;
  }

  async failJobsForStaleWorkers(now: Date, staleAfterMs: number): Promise<string[]> {
    const affected: string[] = [];
    for (const job of this.rows.values()) {
      if (!ACTIVE_STATUSES.includes(job.status)) {
        continue;
      }
      if (!this.workerRepository) {
        // No worker repository wired - nothing to check staleness against,
        // so assume healthy rather than assume stale (see class doc comment).
        continue;
      }
      const worker = await this.workerRepository.findById(job.workerId);
      const lastHeartbeatAt = worker?.lastHeartbeatAt ?? null;
      const isStale = !lastHeartbeatAt || now.getTime() - lastHeartbeatAt.getTime() > staleAfterMs;
      if (isStale) {
        this.rows.set(job.id, {
          ...job,
          status: "FAILED",
          error: { code: "WORKER_OFFLINE", message: "worker heartbeat went stale while this job was active" },
          completedAt: now,
          updatedAt: now
        });
        affected.push(job.id);
      }
    }
    return affected;
  }

  async countActiveForWorker(workerId: string): Promise<number> {
    return [...this.rows.values()].filter(
      (job) => job.workerId === workerId && ACTIVE_STATUSES.includes(job.status)
    ).length;
  }

  async hasNonTerminalJobForOperation(workerId: string, operation: WorkerCapability): Promise<boolean> {
    return [...this.rows.values()].some(
      (job) => job.workerId === workerId && job.operation === operation && !isJobTerminal(job.status)
    );
  }

  async findMostRecentForSessionKey(
    operation: WorkerCapability,
    executionSessionId: string,
    key: "scenePlanId" | "variant",
    value: string
  ): Promise<Job | null> {
    const matches = [...this.rows.values()]
      .filter((job) => {
        if (job.operation !== operation) {
          return false;
        }
        const payload = job.payload;
        if (!payload || typeof payload !== "object") {
          return false;
        }
        const record = payload as Record<string, unknown>;
        return record.executionSessionId === executionSessionId && record[key] === value;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  }

  async listByCreatedByUserId(userId: string, limit: number): Promise<Job[]> {
    return [...this.rows.values()]
      .filter((job) => job.createdByUserId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}
