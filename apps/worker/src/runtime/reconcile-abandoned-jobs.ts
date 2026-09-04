import type { JobDto } from "@dyo/schemas";
import { nextBackoffDelayMs, type BackoffPolicy } from "../infrastructure/backoff.js";

export interface ReconcileAbandonedJobsLogger {
  info: (meta: Record<string, unknown>, message: string) => void;
  warn: (meta: Record<string, unknown>, message: string) => void;
}

/**
 * ROOT CAUSE (2026-09-04, proven via apps/worker/src/runtime/reconcile-abandoned-jobs.wire.test.ts's
 * "PROVEN ROOT CAUSE" reproduction, run against a real ApiClient over a
 * real HTTP server): this function originally made exactly ONE attempt at
 * listActiveJobs() and ONE attempt per reportJobStatus() call, with no
 * retry - despite its own now-corrected doc comment previously CLAIMING
 * "will simply try again once the heartbeat loop is running" (false -
 * nothing anywhere ever called this function a second time; it only runs
 * once, at startup, before loop.start()). A single transient failure on
 * that one attempt - entirely plausible in the seconds right after a
 * fresh process start, e.g. a brief network/DNS blip - permanently
 * stranded reconciliation until the next full process restart, with
 * nothing left in the API's own request log to show it was ever
 * attempted. This is fully consistent with the real incident: job
 * c19a2fb9 stayed RUNNING after build bf680f0 was installed and started
 * (confirmed via genuinely new PID/exact build commit/fresh heartbeats),
 * while the API's complete request log showed zero GET /jobs/active
 * requests ever, from any worker.
 */
const RECONCILE_RETRY_POLICY: BackoffPolicy = { baseMs: 1_000, maxMs: 5_000 };
const RECONCILE_MAX_ATTEMPTS = 4;

export interface ReconcileAbandonedJobsDeps {
  listActiveJobs: () => Promise<JobDto[]>;
  reportJobStatus: (jobId: string, body: { status: "FAILED"; error: { code: "ABANDONED_RECONCILED"; message: string } }) => Promise<unknown>;
  logger?: ReconcileAbandonedJobsLogger;
  /** Test-only override for the retry policy above - production always uses RECONCILE_RETRY_POLICY/RECONCILE_MAX_ATTEMPTS when omitted, same "test-only override" convention as elsewhere in this codebase. */
  retryOptions?: { maxAttempts: number; policy: BackoffPolicy };
  /** Test-only injection point for the retry delay itself - production always uses a real setTimeout-based sleep when omitted. */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded retry with exponential backoff - never a tight loop, never unbounded. Rethrows the last error once attempts are exhausted. */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  policy: BackoffPolicy,
  sleep: (ms: number) => Promise<void>,
  onAttemptFailed?: (attempt: number, error: unknown) => void
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      onAttemptFailed?.(attempt, error);
      if (attempt < maxAttempts) {
        await sleep(nextBackoffDelayMs(attempt, policy));
      }
    }
  }
  throw lastError;
}

/**
 * Runs once at Worker startup, before the heartbeat loop starts claiming
 * new work (P3/P4, 2026-09-04 stuck-job recovery). A freshly started
 * process's own JobExecutionRegistry is always empty - by definition, this
 * process cannot be racing its own prior self - so any job the API still
 * shows as non-terminal for this workerId was left behind by a PREVIOUS
 * worker process that crashed, was killed, or was force-restarted without
 * ever reporting its own outcome (see job c19a2fb9, real production
 * incident this responds to).
 *
 * IMPORTANT - this alone does not prove the old process's owned ae-mcp
 * child is gone: only a real OS-level check/kill on the Windows machine
 * itself can prove that (see deploy/windows-worker/DYO-Worker-Recover.ps1,
 * which now terminates any ae-mcp process before restarting the worker).
 * This function's job is narrower and honest about that boundary: it only
 * reconciles the API's own bookkeeping (a job stuck non-terminal, blocking
 * maxConcurrency=1 forever) once this fresh process is running - it is the
 * recovery script's own responsibility to have already made the "no
 * leftover execution" guarantee true before this process was even started.
 *
 * Both the initial listActiveJobs() call and each job's own
 * reportJobStatus() call are now retried with bounded exponential backoff
 * (see this module's own ROOT CAUSE comment above) - a single transient
 * failure no longer permanently strands reconciliation until the next
 * restart.
 */
export async function reconcileAbandonedJobs(deps: ReconcileAbandonedJobsDeps): Promise<void> {
  const maxAttempts = deps.retryOptions?.maxAttempts ?? RECONCILE_MAX_ATTEMPTS;
  const policy = deps.retryOptions?.policy ?? RECONCILE_RETRY_POLICY;
  const sleep = deps.sleep ?? defaultSleep;

  let active: JobDto[];
  try {
    active = await withRetry(deps.listActiveJobs, maxAttempts, policy, sleep, (attempt, error) => {
      deps.logger?.warn(
        { attempt, maxAttempts, error: error instanceof Error ? error.message : String(error) },
        "checking for abandoned jobs at startup failed - retrying with bounded backoff"
      );
    });
  } catch (error) {
    deps.logger?.warn(
      { attempts: maxAttempts, error: error instanceof Error ? error.message : String(error) },
      "could not check for abandoned jobs at startup after exhausting all retry attempts - will NOT be retried again until this process itself restarts"
    );
    return;
  }

  if (active.length === 0) {
    return;
  }

  deps.logger?.warn(
    { jobIds: active.map((job) => job.jobId), operations: active.map((job) => job.operation) },
    "found non-terminal job(s) left behind by a previous worker process - reconciling to FAILED now that this fresh process confirms it owns no execution for them"
  );

  for (const job of active) {
    try {
      await withRetry(
        () =>
          deps.reportJobStatus(job.jobId, {
            status: "FAILED",
            error: {
              code: "ABANDONED_RECONCILED",
              message:
                "This job was left non-terminal by a worker process that never reported its own outcome " +
                "(crashed, was killed, or was restarted mid-job). A freshly started worker process found " +
                "it still active at startup and reconciled it - re-dispatch is safe."
            }
          }),
        maxAttempts,
        policy,
        sleep,
        (attempt, error) => {
          deps.logger?.warn(
            { jobId: job.jobId, attempt, maxAttempts, error: error instanceof Error ? error.message : String(error) },
            "reconciling one abandoned job failed - retrying with bounded backoff"
          );
        }
      );
      deps.logger?.info({ jobId: job.jobId }, "reconciled abandoned job to FAILED");
    } catch (error) {
      deps.logger?.warn(
        { jobId: job.jobId, attempts: maxAttempts, error: error instanceof Error ? error.message : String(error) },
        "could not reconcile abandoned job after exhausting all retry attempts - it will remain non-terminal until this process restarts"
      );
    }
  }
}
