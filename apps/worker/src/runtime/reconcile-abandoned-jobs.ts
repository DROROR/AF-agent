import type { JobDto } from "@dyo/schemas";

export interface ReconcileAbandonedJobsLogger {
  info: (meta: Record<string, unknown>, message: string) => void;
  warn: (meta: Record<string, unknown>, message: string) => void;
}

export interface ReconcileAbandonedJobsDeps {
  listActiveJobs: () => Promise<JobDto[]>;
  reportJobStatus: (jobId: string, body: { status: "FAILED"; error: { code: "ABANDONED_RECONCILED"; message: string } }) => Promise<unknown>;
  logger?: ReconcileAbandonedJobsLogger;
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
 */
export async function reconcileAbandonedJobs(deps: ReconcileAbandonedJobsDeps): Promise<void> {
  let active: JobDto[];
  try {
    active = await deps.listActiveJobs();
  } catch (error) {
    deps.logger?.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "could not check for abandoned jobs at startup - will simply try again once the heartbeat loop is running"
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
      await deps.reportJobStatus(job.jobId, {
        status: "FAILED",
        error: {
          code: "ABANDONED_RECONCILED",
          message:
            "This job was left non-terminal by a worker process that never reported its own outcome " +
            "(crashed, was killed, or was restarted mid-job). A freshly started worker process found " +
            "it still active at startup and reconciled it - re-dispatch is safe."
        }
      });
      deps.logger?.info({ jobId: job.jobId }, "reconciled abandoned job to FAILED");
    } catch (error) {
      deps.logger?.warn(
        { jobId: job.jobId, error: error instanceof Error ? error.message : String(error) },
        "could not reconcile abandoned job - it will remain non-terminal until this succeeds"
      );
    }
  }
}
