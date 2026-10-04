import type { JobDto, ReportJobStatusRequest } from "@dyo/schemas";
import type { JobExecutionResult } from "../domain/job-dispatcher.js";
import { nextBackoffDelayMs, type BackoffPolicy } from "../infrastructure/backoff.js";

export type JobCycleEvent =
  | { type: "no_job_available" }
  | { type: "job_claimed"; jobId: string; operation: string }
  | { type: "job_completed"; jobId: string; status: "SUCCEEDED" | "FAILED" }
  | { type: "job_cycle_failed"; error: unknown };

export interface JobCycleDeps {
  claimNextJob: () => Promise<{ job: JobDto | null }>;
  reportJobStatus: (jobId: string, body: ReportJobStatusRequest) => Promise<JobDto>;
  executeJob: (job: JobDto) => Promise<JobExecutionResult>;
  onEvent?: (event: JobCycleEvent) => void;
  /** Test-only overrides - production uses REPORT_MAX_ATTEMPTS / REPORT_RETRY_POLICY and a real timer. */
  reportRetry?: { maxAttempts: number; policy: BackoffPolicy };
  sleep?: (ms: number) => Promise<void>;
}

/**
 * REAL 2026-10-04 INCIDENT (job 15ad8fab). The worker's network dropped for
 * about twenty seconds. In that window it claimed a job, and its one attempt
 * to report the job RUNNING failed ("Failed to reach .../report"). The cycle
 * gave up - and the job stayed CLAIMED for good: a claimed job is never
 * handed out again, and the server only reaps jobs of a worker whose
 * heartbeat has gone stale, which this worker's had not. The dashboard waited
 * on it until a person failed it by hand.
 *
 * A status report is a small request the job's whole outcome hangs on, so it
 * is retried with bounded backoff - about a minute in all - both when the job
 * starts and, more importantly, when it ends: a finished job whose result
 * could not be delivered was lost in exactly the same way. A report that
 * still cannot be delivered ends the cycle as before, and index.ts then
 * reconciles whatever this worker left active before claiming anything else.
 */
export const REPORT_MAX_ATTEMPTS = 6;
export const REPORT_RETRY_POLICY: BackoffPolicy = { baseMs: 2_000, maxMs: 30_000 };

async function reportWithRetry(deps: JobCycleDeps, jobId: string, body: ReportJobStatusRequest): Promise<void> {
  const maxAttempts = deps.reportRetry?.maxAttempts ?? REPORT_MAX_ATTEMPTS;
  const policy = deps.reportRetry?.policy ?? REPORT_RETRY_POLICY;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await deps.reportJobStatus(jobId, body);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(nextBackoffDelayMs(attempt, policy));
      }
    }
  }
  throw lastError;
}

/**
 * One bounded attempt: claim -> report RUNNING -> execute -> report final
 * status. The claim and the execution are never retried here - this is
 * called once per successful heartbeat tick (see index.ts). The two status
 * reports are (see reportWithRetry): a claimed job is never handed out
 * again, so "tried again on the next heartbeat" was never true of them.
 * Never throws - every failure path is
 * reported via onEvent so the caller (the heartbeat loop) is never blocked
 * or crashed by a job problem.
 */
export async function runJobCycle(deps: JobCycleDeps): Promise<void> {
  let claimed: { job: JobDto | null };
  try {
    claimed = await deps.claimNextJob();
  } catch (error) {
    deps.onEvent?.({ type: "job_cycle_failed", error });
    return;
  }

  const job = claimed.job;
  if (!job) {
    deps.onEvent?.({ type: "no_job_available" });
    return;
  }

  deps.onEvent?.({ type: "job_claimed", jobId: job.jobId, operation: job.operation });

  try {
    await reportWithRetry(deps, job.jobId, { status: "RUNNING" });
  } catch (error) {
    deps.onEvent?.({ type: "job_cycle_failed", error });
    return;
  }

  let executionResult: JobExecutionResult;
  try {
    executionResult = await deps.executeJob({ ...job, status: "RUNNING" });
  } catch (error) {
    // This call was previously unguarded: an exception here escaped
    // runJobCycle entirely and, since index.ts invokes it as
    // `void runJobCycle(...)` with no .catch(), became an unhandled
    // promise rejection - which crashes the whole worker process under
    // Node's default unhandledRejection behavior. That directly
    // contradicts this function's own "Never throws" contract above and
    // masks a job-execution bug as a total worker outage instead of a
    // single reported job failure.
    deps.onEvent?.({ type: "job_cycle_failed", error });
    return;
  }

  try {
    await reportWithRetry(deps, job.jobId, {
      status: executionResult.status,
      ...(executionResult.result !== undefined ? { result: executionResult.result } : {}),
      ...(executionResult.error !== undefined ? { error: executionResult.error } : {})
    });
    deps.onEvent?.({ type: "job_completed", jobId: job.jobId, status: executionResult.status });
  } catch (error) {
    deps.onEvent?.({ type: "job_cycle_failed", error });
  }
}
