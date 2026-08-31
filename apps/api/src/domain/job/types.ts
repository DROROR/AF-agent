import type { JobErrorCode, JobStatus, WorkerCapability } from "@dyo/schemas";

export interface JobFailure {
  code: JobErrorCode;
  message: string;
}

export interface Job {
  id: string;
  workerId: string;
  /** Null for operations not bound to a project (e.g. CHECK_HEALTH) - see job-dispatch.ts. */
  projectId: string | null;
  /** The dashboard user who dispatched this job, or null - see schema.ts's own doc comment and get-job-for-user.ts. */
  createdByUserId: string | null;
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
  projectId?: string | null;
  createdByUserId?: string | null;
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
  /**
   * Durable MID-JOB progress update - deliberately NEVER a status
   * transition (no `expectedCurrentStatus`/`status` fields, unlike
   * updateStatus above): this only ever writes `checkpoint`/`updatedAt`,
   * gated by a compare-and-swap on (id, workerId, status = 'RUNNING').
   * Returns null if the job doesn't exist, isn't owned by workerId, or is
   * no longer RUNNING (already completed, failed, or reassigned) - the
   * application layer treats all three identically (a real race, not a
   * distinguishable error), same "never confirm which case" pattern as
   * updateStatus. Monotonicity (never let completed operation indices
   * move backward) is enforced by the application layer BEFORE calling
   * this, not here - this method only ever performs the write.
   */
  updateCheckpoint(jobId: string, workerId: string, checkpoint: unknown, now: Date): Promise<Job | null>;
  /** Fails every non-terminal job belonging to a worker whose heartbeat is stale - recovery for "worker goes offline while running/before claim". Returns affected job IDs. */
  failJobsForStaleWorkers(now: Date, staleAfterMs: number): Promise<string[]>;
  /** Count of this worker's non-QUEUED, non-terminal jobs (CLAIMED/RUNNING/WAITING_FOR_ACTION) - the same "in flight" definition claimNextForWorker's concurrency gate uses. Used by job dispatch to refuse creating a job past maxConcurrency. */
  countActiveForWorker(workerId: string): Promise<number>;
  /** True if this worker already has a non-terminal job (QUEUED or later, up to but excluding SUCCEEDED/FAILED/CANCELLED) for this exact operation - used by job dispatch to refuse a duplicate/double-submit dispatch of the same operation. */
  hasNonTerminalJobForOperation(workerId: string, operation: WorkerCapability): Promise<boolean>;
  /**
   * The most recently CREATED job for this exact (operation,
   * executionSessionId, key/value) combination, across ANY status - used by
   * job dispatch to find a prior attempt's own durable checkpoint so a
   * genuine worker-crash resume can carry it forward (see
   * resolve-resume-checkpoint.ts). `key` addresses the one JSON payload
   * field that identifies "the same scene" (EXECUTE_FRAME's own
   * scenePlanId) or "the same render target" (RENDER's own variant) - never
   * a free-form JSON path. Returns null if no such job has ever been
   * dispatched.
   */
  findMostRecentForSessionKey(
    operation: WorkerCapability,
    executionSessionId: string,
    key: "scenePlanId" | "variant",
    value: string
  ): Promise<Job | null>;
  /** This user's own full dispatch history, newest first, capped at `limit` - see list-jobs-for-user.ts ("job history + errors" closure requirement). Never another user's jobs. */
  listByCreatedByUserId(userId: string, limit: number): Promise<Job[]>;
  /** True if any job for this project is still non-terminal (QUEUED/CLAIMED/RUNNING/WAITING_FOR_ACTION) - used by delete-project.ts to refuse deleting a project out from under an in-flight worker job. */
  hasNonTerminalJobForProject(projectId: string): Promise<boolean>;
}
