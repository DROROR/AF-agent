/**
 * Short, bounded backoff (the task's own Scheduled-Task-level
 * RestartInterval is a full 1 minute and only ever fires if THIS
 * supervisor itself dies - see docs on supervisor/index.ts). The
 * supervisor's own inner backoff exists only to avoid a hot crash-loop
 * pegging the CPU/log if the worker fails instantly and repeatedly; it is
 * deliberately much shorter than the Task-Scheduler-level backstop.
 */
export const BASE_BACKOFF_MS = 2_000;
export const MAX_BACKOFF_MS = 30_000;

/** Doubles per attempt, capped - deterministic given `restartCount` alone, no randomness. */
export function computeBackoffMs(restartCount: number): number {
  const attempt = Math.max(0, restartCount);
  const doubled = BASE_BACKOFF_MS * 2 ** attempt;
  return Math.min(doubled, MAX_BACKOFF_MS);
}

export interface RestartDecisionInput {
  /** From maintenance-flag.ts - true whenever the updater/repair/uninstall flow is in progress. */
  maintenanceActive: boolean;
  /** How many restart attempts have already happened since this supervisor process started. */
  restartCount: number;
}

export interface RestartDecision {
  shouldRestart: boolean;
  /** Only meaningful when shouldRestart is true. */
  backoffMs: number;
  reason: string;
}

/**
 * The one place "should the supervisor start another worker child right
 * now" is decided - pure and fully deterministic given its inputs, so this
 * is unit-testable without any real process/filesystem/clock. Maintenance
 * always wins: an ordinary crash during maintenance must NOT restart (the
 * updater owns starting the worker back up once it clears the flag) -
 * never a race between "worker just exited" and "maintenance flag was
 * just set", because the flag is checked fresh at the moment of decision.
 */
export function decideRestart(input: RestartDecisionInput): RestartDecision {
  if (input.maintenanceActive) {
    return { shouldRestart: false, backoffMs: 0, reason: "maintenance is in progress - the updater/repair owns restarting the worker" };
  }
  return {
    shouldRestart: true,
    backoffMs: computeBackoffMs(input.restartCount),
    reason: "worker child exited while no maintenance is in progress"
  };
}
