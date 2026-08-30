import { decideRestart } from "./restart-policy.js";

export interface WorkerChildHandleLike {
  pid: number;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  requestStop: () => void;
}

export interface SupervisorLoopLogger {
  info: (meta: Record<string, unknown>, message: string) => void;
}

export interface SupervisorLoopDeps {
  spawnChild: () => WorkerChildHandleLike;
  isMaintenanceActive: () => boolean;
  sleep: (ms: number) => Promise<void>;
  logger: SupervisorLoopLogger;
  /** Logged on every restart for diagnostics - never a secret, matches version.ts's readWorkerBuildInfo shape. */
  buildInfo: unknown;
  /** How long to wait before re-checking whether maintenance has ended. Defaults to 2000ms. */
  maintenancePollMs?: number;
}

export interface SupervisorLoopControl {
  /** Runs the supervise-restart cycle until stop() is called. Resolves once it has fully wound down. */
  run: () => Promise<void>;
  /** Asks the loop to stop - forwards the request to any currently-running child immediately, and prevents any further restart once it exits. Idempotent. */
  stop: () => void;
}

/**
 * The real, stateful orchestration loop - restart-policy.ts's decideRestart
 * (pure) makes every actual decision; this just wires that decision to a
 * real (or, in tests, fake) child process and clock. Kept deliberately
 * separate from restart-policy.ts so the DECISION logic stays trivially
 * unit-testable, while this loop is tested with fake spawnChild/sleep -
 * still fully deterministic, no real timers/processes, no flakiness.
 *
 * Maintenance-flag race (why checking isMaintenanceActive() BOTH before
 * spawning AND again right after a child exits matters): the updater sets
 * the maintenance flag BEFORE stopping the Scheduled Task/this supervisor
 * - but a worker child can die on its own (an ordinary crash) in the
 * narrow window before this supervisor's own stop signal has arrived.
 * Checking the flag fresh at the exact moment of the restart DECISION
 * (not just once at loop start) closes that race: even if this
 * supervisor hasn't been asked to stop YET, it will not spawn a fresh
 * child once maintenance has begun, so it can never race the updater's
 * own file replacement with a freshly-started worker process.
 */
export function createSupervisorLoop(deps: SupervisorLoopDeps): SupervisorLoopControl {
  const maintenancePollMs = deps.maintenancePollMs ?? 2_000;
  let stopRequested = false;
  let currentChild: WorkerChildHandleLike | null = null;
  let restartCount = 0;
  let previousPid: number | null = null;
  let previousExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;

  async function run(): Promise<void> {
    while (!stopRequested) {
      if (deps.isMaintenanceActive()) {
        deps.logger.info({}, "maintenance is in progress - waiting before starting the worker");
        await deps.sleep(maintenancePollMs);
        continue;
      }

      const child = deps.spawnChild();
      currentChild = child;
      deps.logger.info(
        { previousPid, newPid: child.pid, restartCount, previousExit, buildInfo: deps.buildInfo },
        "supervisor started a new worker child"
      );

      const exit = await child.exited;
      currentChild = null;
      previousPid = child.pid;
      previousExit = exit;
      deps.logger.info({ pid: child.pid, exit }, "worker child exited");

      if (stopRequested) {
        break;
      }

      const decision = decideRestart({ maintenanceActive: deps.isMaintenanceActive(), restartCount });
      if (!decision.shouldRestart) {
        deps.logger.info({ reason: decision.reason }, "not restarting the worker child right now");
        continue;
      }

      deps.logger.info(
        { backoffMs: decision.backoffMs, nextRestartCount: restartCount + 1, reason: decision.reason },
        "restarting the worker child after a bounded backoff"
      );
      await deps.sleep(decision.backoffMs);
      restartCount += 1;
    }
    deps.logger.info({ restartCount }, "supervisor loop stopped");
  }

  function stop(): void {
    stopRequested = true;
    currentChild?.requestStop();
  }

  return { run, stop };
}
