import type { JobDto, ReportJobStatusRequest } from "@dyo/schemas";
import type { JobExecutionResult } from "../domain/job-dispatcher.js";

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
}

/**
 * One bounded attempt: claim -> report RUNNING -> execute -> report final
 * status. No internal retry loop - this is called once per successful
 * heartbeat tick (see index.ts), so a failure at any step is simply tried
 * again on the next heartbeat, naturally paced by HEARTBEAT_INTERVAL_MS
 * rather than a tight/blind retry. Never throws - every failure path is
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
    await deps.reportJobStatus(job.jobId, { status: "RUNNING" });
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
    await deps.reportJobStatus(job.jobId, {
      status: executionResult.status,
      ...(executionResult.result !== undefined ? { result: executionResult.result } : {}),
      ...(executionResult.error !== undefined ? { error: executionResult.error } : {})
    });
    deps.onEvent?.({ type: "job_completed", jobId: job.jobId, status: executionResult.status });
  } catch (error) {
    deps.onEvent?.({ type: "job_cycle_failed", error });
  }
}
