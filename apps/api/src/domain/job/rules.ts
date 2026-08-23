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
