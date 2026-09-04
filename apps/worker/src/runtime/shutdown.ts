import type { HeartbeatLoop } from "./heartbeat-loop.js";

export interface ShutdownLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

export interface ShutdownDeps {
  loop: HeartbeatLoop;
  logger: ShutdownLogger;
  /** True if a job is currently tracked as active (see JobExecutionRegistry.hasActiveJob()). */
  hasActiveJob: () => boolean;
  /** Terminates every owned MCP child process for the active job - see JobExecutionRegistry.abortActiveJob(). Only ever called when hasActiveJob() was true. */
  abortActiveJob: (reason: string) => Promise<unknown>;
  /** The in-flight runJobCycle promise, or null if none is currently running - see index.ts's own tracked (no longer fire-and-forget) job cycle. */
  getActiveJobCyclePromise: () => Promise<void> | null;
  /** Bound on how long to wait for the aborted job cycle to settle after requesting abort, before giving up and exiting anyway. Defaults to 15s. */
  jobDrainTimeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stops the heartbeat loop cleanly and waits for any in-flight tick to
 * settle, THEN (P1, 2026-09-04 stuck-job fix) - if a job is currently
 * active - requests its owned MCP child process(es) be terminated and
 * waits (bounded) for the tracked job-cycle promise to actually settle,
 * before this process exits.
 *
 * Real gap this closes: shutdownGracefully previously only stopped the
 * heartbeat loop - job execution runs on its own independent cycle
 * (index.ts's `void runJobCycle(...)`, never awaited by a heartbeat tick),
 * so a restart/recycle could exit mid-job, potentially orphaning that
 * job's own ae-mcp child process with no attempt to stop it first. This
 * makes shutdown genuinely wait for (and try to prove) that cleanup,
 * rather than merely hoping restart-policy.ts's backoff gives it enough
 * time by accident.
 */
export async function shutdownGracefully(deps: ShutdownDeps): Promise<void> {
  deps.logger.info("Shutting down: stopping heartbeat loop");
  deps.loop.stop();
  await deps.loop.waitForIdle();

  if (deps.hasActiveJob()) {
    deps.logger.info("Shutdown: active job detected - requesting abort and waiting for owned MCP process cleanup");
    await deps.abortActiveJob("worker shutdown");

    const jobCyclePromise = deps.getActiveJobCyclePromise();
    if (jobCyclePromise) {
      const timeoutMs = deps.jobDrainTimeoutMs ?? 15_000;
      const outcome = await Promise.race([
        jobCyclePromise.then(
          () => "settled" as const,
          () => "settled" as const
        ),
        sleep(timeoutMs).then(() => "timed_out" as const)
      ]);
      if (outcome === "timed_out") {
        deps.logger.warn("Shutdown: active job cycle did not settle within the drain timeout - proceeding anyway", {
          timeoutMs
        });
      } else {
        deps.logger.info("Shutdown: active job cycle settled after abort");
      }
    }
  }

  deps.logger.info("Shutdown complete");
}
