import { JOB_STATUS_TRANSITIONS, TERMINAL_JOB_STATUSES, type JobStatus } from "@dyo/schemas";

/** Pure business rules for job state - no I/O, no framework, independently testable (mirrors domain/worker/rules.ts). */

export function isJobTerminal(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/** The single gate every status change must pass - CLAUDE.md/ARCHITECTURE_RULES.md "job state machine transitions must be explicit and validated". */
export function isValidJobStatusTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_STATUS_TRANSITIONS[from].includes(to);
}

export function canClaimAnotherJob(activeJobCount: number, maxConcurrency: number): boolean {
  return activeJobCount < maxConcurrency;
}

/**
 * A job the worker may still be sending results for: RUNNING, or FAILED by
 * the stale-worker sweep (WORKER_OFFLINE) while the worker - whose machine
 * only lost its connection - is in fact still working on it. REAL
 * 2026-11-01 (worker FAHADNAKASH): a swept job finished, saved its working
 * copy, and its preview upload was refused as "not RUNNING"; the session
 * never learned the new hash and the next scene failed on the mismatch.
 * The worker's own terminal report already wins over the sweep's verdict
 * (report-job-status.ts); its uploads must be accepted for the same reason.
 */
export function isJobStillBeingWorkedOn(job: { status: JobStatus; error: { code: string } | null }): boolean {
  return job.status === "RUNNING" || (job.status === "FAILED" && job.error?.code === "WORKER_OFFLINE");
}
