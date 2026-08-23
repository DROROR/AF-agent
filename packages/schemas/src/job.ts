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
