import type { JobErrorCode, JobStatus, WorkerCapability } from "@dyo/schemas";

export interface JobFailure {
  code: JobErrorCode;
  message: string;
}

export interface Job {
  id: string;
  workerId: string;
  operation: WorkerCapability;
  status: JobStatus;
  payload: unknown;
  result: unknown | null;
  error: JobFailure | null;
  checkpoint: unknown | null;
  createdAt: Date;
  claimedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface NewJob {
  id: string;
  workerId: string;
  operation: WorkerCapability;
  payload: unknown;
}

export interface JobStatusUpdate {
  /**
   * Compare-and-swap guard: the repository must only apply this update if
   * the job's status is still exactly this value at write time. Closes the
   * race between an application-layer transition check (read) and the
   * actual write - two concurrent reports racing against the same job can
   * never both succeed.
   */
  expectedCurrentStatus: JobStatus;
  status: JobStatus;
  result?: unknown;
  error?: JobFailure;
  checkpoint?: unknown;
}

/**
 * Port the application layer depends on - see docs/engineering/CODE_STANDARDS.md's
 * dependency direction (route -> application -> domain -> repository).
 * Implemented by infrastructure/db/drizzle-job-repository.ts in production
 * and an in-memory fake in unit tests.
 */
export interface JobRepository {
  create(job: NewJob, now: Date): Promise<Job>;
  findById(id: string): Promise<Job | null>;
  /**
   * Atomically claims this worker's oldest QUEUED job, if any exists and the
   * worker is under its maxConcurrency limit. Must never let two concurrent
   * calls claim the same job (STEP "no duplicate claim").
   */
  claimNextForWorker(workerId: string, maxConcurrency: number, now: Date): Promise<Job | null>;
  /**
   * Applies a status update to a job. Returns null if the job doesn't
   * exist or isn't owned by workerId - callers must not assume "not
   * found" and "not yours" are distinguishable from this alone (both map
   * to the same 404, so a worker can never probe for another worker's job
   * IDs by observing a different error).
   */
  updateStatus(jobId: string, workerId: string, update: JobStatusUpdate, now: Date): Promise<Job | null>;
  /** Fails every non-terminal job belonging to a worker whose heartbeat is stale - recovery for "worker goes offline while running/before claim". Returns affected job IDs. */
  failJobsForStaleWorkers(now: Date, staleAfterMs: number): Promise<string[]>;
}
