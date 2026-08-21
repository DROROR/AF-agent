import type { AeStatus, McpStatus, WorkerCapability, WorkerStatus } from "@dyo/schemas";

export interface Worker {
  id: string;
  name: string;
  tokenHash: string;
  status: WorkerStatus;
  aeStatus: AeStatus;
  mcpStatus: McpStatus;
  aeVersion: string | null;
  capabilities: WorkerCapability[];
  maxConcurrency: number;
  currentJobId: string | null;
  lastHeartbeatAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewWorker {
  id: string;
  name: string;
  tokenHash: string;
  maxConcurrency: number;
  capabilities: WorkerCapability[];
}

export interface WorkerHeartbeatUpdate {
  aeStatus: AeStatus;
  mcpStatus: McpStatus;
  aeVersion: string | null;
  capabilities?: WorkerCapability[];
  maxConcurrency?: number;
  currentJobId: string | null;
}

/**
 * Port the application layer depends on. Implemented by
 * infrastructure/db/drizzle-worker-repository.ts in production and by an
 * in-memory fake in unit tests - see docs/engineering/CODE_STANDARDS.md's
 * dependency direction (route -> application -> domain -> repository).
 */
export interface WorkerRepository {
  create(worker: NewWorker, now: Date): Promise<Worker>;
  findById(id: string): Promise<Worker | null>;
  findAll(): Promise<Worker[]>;
  updateHeartbeat(id: string, update: WorkerHeartbeatUpdate, now: Date): Promise<Worker | null>;
  /** Persists ONLINE -> OFFLINE for every worker whose heartbeat is stale. Returns affected worker IDs. */
  markStaleWorkersOffline(now: Date, staleAfterMs: number): Promise<string[]>;
}
