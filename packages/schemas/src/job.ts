import { z } from "zod";
import { workerCapabilitySchema } from "./worker.js";

/**
 * Job state machine. CLAUDE.md / docs/engineering/ARCHITECTURE_RULES.md:
 * "job state machine transitions must be explicit and validated" - see
 * JOB_STATUS_TRANSITIONS below, the single source of truth for which
 * transitions are ever valid. Nothing applies a transition outside this table.
 */
export const JOB_STATUSES = [
  "QUEUED",
  "CLAIMED",
  "RUNNING",
  "WAITING_FOR_ACTION",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED"
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const jobStatusSchema = z.enum(JOB_STATUSES);

/** Once in one of these, a job accepts no further status transition and cannot be claimed/reclaimed. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED"];

export const JOB_STATUS_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  QUEUED: ["CLAIMED", "CANCELLED"],
  CLAIMED: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["WAITING_FOR_ACTION", "SUCCEEDED", "FAILED", "CANCELLED"],
  WAITING_FOR_ACTION: ["RUNNING", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: []
};

/** Typed failure reasons a worker (or the API) may report - never a free-text-only failure, so callers can react programmatically. */
export const JOB_ERROR_CODES = [
  "NOT_AVAILABLE",
  "UNSUPPORTED_OPERATION",
  "INVALID_PAYLOAD",
  "TRANSPORT_ERROR",
  "WORKER_OFFLINE",
  /**
   * A required safety precondition (e.g. AE/MCP confirmed ONLINE as of the
   * most recent heartbeat) was not met when the worker attempted to run
   * the job - not a transport failure, not a bug, just "not safe to
   * attempt right now". Distinct from NOT_AVAILABLE (no implementation
   * exists at all) and TRANSPORT_ERROR (an attempt was made and failed).
   */
  "PRECONDITION_NOT_MET",
  "INTERNAL_ERROR"
] as const;
export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];
export const jobErrorCodeSchema = z.enum(JOB_ERROR_CODES);

export const jobErrorSchema = z.object({
  code: jobErrorCodeSchema,
  message: z.string().min(1)
});
export type JobError = z.infer<typeof jobErrorSchema>;

/**
 * Job payload/result are intentionally `z.unknown()` at this generic layer
 * - job-payload.ts maps each operation to its own real schema and validates
 * against that specific shape, both when a job is created and again when a
 * worker claims it. This file never accepts an arbitrary command string:
 * `operation` reuses workerCapabilitySchema (worker.ts), the single
 * allowlist source of truth - see docs/engineering/SECURITY.md.
 */
export const jobDtoSchema = z.object({
  jobId: z.string().uuid(),
  workerId: z.string().uuid(),
  /** Null for operations not bound to a project (e.g. CHECK_HEALTH) - set at dispatch time, never inferred or backfilled later. */
  projectId: z.string().uuid().nullable(),
  operation: workerCapabilitySchema,
  status: jobStatusSchema,
  payload: z.unknown(),
  result: z.unknown().nullable(),
  error: jobErrorSchema.nullable(),
  checkpoint: z.unknown().nullable(),
  createdAt: z.string().datetime(),
  claimedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime()
});
export type JobDto = z.infer<typeof jobDtoSchema>;

/** POST /api/workers/:workerId/jobs/claim - empty body, the worker asks for its own next queued job. */
export const claimJobResponseSchema = z.object({
  job: jobDtoSchema.nullable()
});
export type ClaimJobResponse = z.infer<typeof claimJobResponseSchema>;

/**
 * GET /api/jobs/:jobId (dashboard session) - see get-job-for-user.ts. The
 * caller must check `status` before ever treating `result` as valid data:
 * only "SUCCEEDED" means `result` is the operation's real output (e.g.
 * InspectTemplateResponse for INSPECT_TEMPLATE) - QUEUED/CLAIMED/RUNNING
 * carry no result yet, and FAILED/CANCELLED never carry a usable one
 * regardless of what `result` happens to hold.
 */
export const getJobResponseSchema = z.object({
  job: jobDtoSchema
});
export type GetJobResponse = z.infer<typeof getJobResponseSchema>;

/**
 * POST /api/workers/:workerId/jobs/:jobId/report - a worker moving its own
 * claimed job forward. `status` must be one JOB_STATUS_TRANSITIONS allows
 * from the job's current status; the API re-validates this, it never trusts
 * the worker's claimed transition blindly.
 */
export const reportJobStatusRequestSchema = z.object({
  status: jobStatusSchema,
  result: z.unknown().optional(),
  error: jobErrorSchema.optional(),
  checkpoint: z.unknown().optional()
});
export type ReportJobStatusRequest = z.infer<typeof reportJobStatusRequestSchema>;

/**
 * POST /api/workers/:workerId/jobs/:jobId/checkpoint - a durable MID-JOB
 * progress update, deliberately NEVER a status transition (there is no
 * `status` field here at all - see report-job-checkpoint.ts). Exists so a
 * worker crash between one EXECUTE_FRAME operation completing and the
 * job's own final report ever reaching the API does not silently lose
 * that completed operation - the checkpoint itself is validated against
 * the specific operation's own checkpoint schema at the application
 * layer (e.g. sceneEditCheckpointSchema for EXECUTE_FRAME), not here -
 * this wire-level contract stays `unknown` the same way
 * reportJobStatusRequestSchema's own `checkpoint` field already does.
 */
export const reportJobCheckpointRequestSchema = z.object({
  checkpoint: z.unknown()
});
export type ReportJobCheckpointRequest = z.infer<typeof reportJobCheckpointRequestSchema>;

/**
 * One row of a dashboard user's own job history (GET /api/jobs) - a
 * deliberately DIFFERENT, slimmer shape than jobDtoSchema: this is a
 * dashboard-facing history/audit view (job history + errors, 2026-08-29
 * closure requirement - "no DB/curl access should ever be required to
 * understand what happened to a past job"), so it resolves workerId/
 * projectId into human-readable names server-side (the browser never has
 * to separately fetch every worker/project just to label one history row)
 * and omits payload/result (large and operation-specific) in favor of the
 * fields this view actually needs. `error` reuses jobErrorSchema - already
 * sanitized by construction (a typed {code, message} pair, never a raw
 * stack trace or secret - see docs/engineering/SECURITY.md).
 */
export const jobHistoryEntryDtoSchema = z.object({
  jobId: z.string().uuid(),
  operation: workerCapabilitySchema,
  status: jobStatusSchema,
  workerId: z.string().uuid(),
  workerName: z.string().nullable(),
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  /** EXECUTE_FRAME/RENDER jobs only - null for every operation whose payload carries no executionSessionId. */
  executionSessionId: z.string().uuid().nullable(),
  error: jobErrorSchema.nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime()
});
export type JobHistoryEntryDto = z.infer<typeof jobHistoryEntryDtoSchema>;

/** GET /api/jobs (dashboard session) - the calling user's own dispatch history across every project, newest first, bounded to a fixed count server-side (see list-jobs-for-user.ts). Never another user's jobs, and never filtered by a caller-supplied userId. */
export const listJobsResponseSchema = z.object({
  jobs: z.array(jobHistoryEntryDtoSchema)
});
export type ListJobsResponse = z.infer<typeof listJobsResponseSchema>;
