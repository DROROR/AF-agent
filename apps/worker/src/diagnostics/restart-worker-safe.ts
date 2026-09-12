import type { RestartWorkerSafeRequest, RestartWorkerSafeResponse } from "@dyo/schemas";

/**
 * The one MUTATING diagnostic: restart this worker process safely, remotely,
 * over the existing outbound channel.
 *
 * HOW IT AVOIDS A DUPLICATE TREE - the defect this codebase has already hit
 * twice (2026-09-11 orphaned supervisors, 2026-09-12 PID reuse): it does not
 * start anything. It asks the CURRENT process to exit, and the supervisor
 * that already owns this child starts exactly one replacement, through the
 * same code path it uses for any other exit. Nothing here spawns a second
 * supervisor, a second worker, or a second scheduled task, because nothing
 * here spawns at all.
 *
 * HOW IT PRESERVES IDENTITY: it never reads, writes, moves or re-registers
 * .env, the credential store, or the workerId. The replacement process
 * resolves the same persisted credentials the same way every normal start
 * does (resolveWorkerCredentials's "never silently register a new, duplicate
 * identity" contract). `identityPreserved` reports that this path touched
 * nothing - it is a statement about what this code does, which is why it is
 * derived from the code path taken and not from a re-read of the file.
 */
export const RESTART_EXIT_CODE = 0;

/**
 * How long to wait before exiting, so the job result reaches the API first.
 * Exiting synchronously would leave this very job stuck RUNNING forever -
 * the operator would see the restart as a hang, which is precisely the
 * confusion this feature exists to remove.
 */
export const RESTART_GRACE_MS = 3_000;

/** What the worker knows about whatever it is currently doing. */
export interface ActiveWorkSnapshot {
  jobId: string | null;
  operation: string | null;
  /** True when the in-flight work mutates an AE project or renders - the cases where an abrupt restart can leave real damage or a wasted hour. */
  mutating: boolean;
  /** True when the in-flight work has reached a durable checkpoint it can genuinely resume from. */
  checkpointed: boolean;
}

export interface RestartWorkerSafeDeps {
  workerId: string;
  now: () => Date;
  describeActiveWork: () => ActiveWorkSnapshot;
  /** Injected so the refusal/acceptance decision is testable without ending the test runner's own process. */
  scheduleExit: (delayMs: number, exitCode: number) => void;
  logger: { info: (details: Record<string, unknown>, message: string) => void; warn: (details: Record<string, unknown>, message: string) => void };
}

export function restartWorkerSafe(
  deps: RestartWorkerSafeDeps,
  request: RestartWorkerSafeRequest
): RestartWorkerSafeResponse {
  const requestedAt = deps.now().toISOString();
  const active = deps.describeActiveWork();

  // REFUSE rather than interrupt. CLAUDE.md Safety Rules 1-5: an
  // EXECUTE_FRAME/RENDER in flight is touching a real project copy or
  // producing a real render, and killing it mid-write is exactly the
  // "unsafe" this operation's name promises not to be. A job that HAS a
  // durable checkpoint is safe to restart: that is what checkpoints are for.
  if (active.jobId !== null && active.mutating && !active.checkpointed) {
    deps.logger.warn(
      { jobId: active.jobId, operation: active.operation, reason: request.reason },
      "refusing a remote safe-restart - an uncheckpointed mutating job is in flight"
    );
    return {
      workerId: deps.workerId,
      requestedAt,
      outcome: "refused",
      refusalReason: "UNSAFE_JOB_IN_FLIGHT",
      detail: `Job ${active.jobId} (${active.operation ?? "unknown operation"}) is mutating an After Effects project or rendering and has not reached a durable checkpoint. Nothing was changed. Retry once it completes or checkpoints.`,
      identityPreserved: true
    };
  }

  deps.logger.info(
    { reason: request.reason, activeJobId: active.jobId },
    "remote safe-restart accepted - exiting so the supervisor starts exactly one replacement"
  );
  deps.scheduleExit(RESTART_GRACE_MS, RESTART_EXIT_CODE);

  return {
    workerId: deps.workerId,
    requestedAt,
    outcome: "restarting",
    refusalReason: null,
    detail: `This worker process will exit in ${RESTART_GRACE_MS}ms and its existing supervisor will start exactly one replacement. No new supervisor, scheduled task, or worker identity is created.`,
    identityPreserved: true
  };
}
