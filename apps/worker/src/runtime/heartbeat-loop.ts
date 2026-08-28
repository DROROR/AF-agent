import type { HeartbeatRequest, WorkerDto } from "@dyo/schemas";
import type { BackoffPolicy } from "../infrastructure/backoff.js";
import { nextBackoffDelayMs } from "../infrastructure/backoff.js";
import { UnauthorizedApiError } from "../errors/worker-error.js";

export type HeartbeatLoopEvent =
  | { type: "heartbeat_succeeded"; worker: WorkerDto }
  | {
      type: "heartbeat_failed";
      error: unknown;
      consecutiveFailures: number;
      nextRetryMs: number;
      /**
       * The API reachably rejected our credentials (401) - retrying will
       * never fix this on its own (a revoked/invalid token stays revoked),
       * unlike every other failure category here which is expected to
       * clear up on its own. Still retried the same way (never a reason to
       * exit or re-register - see resolveWorkerCredentials's own "never
       * silently register a new, duplicate identity" contract) so the
       * worker recovers automatically the moment an operator fixes it
       * server-side, but the caller (index.ts) logs this distinctly as
       * NEEDS_ATTENTION rather than the generic "will retry" - see that
       * file's own doc comment.
       */
      authRejected: boolean;
    }
  | { type: "loop_stopped" };

export interface HeartbeatLoopDeps {
  buildPayload: () => Promise<HeartbeatRequest>;
  sendHeartbeat: (payload: HeartbeatRequest) => Promise<WorkerDto>;
  intervalMs: number;
  backoff: BackoffPolicy;
  onEvent?: (event: HeartbeatLoopEvent) => void;
}

/**
 * Drives the heartbeat cadence. On success, resumes the normal interval; on
 * failure, retries with bounded exponential backoff instead of a tight loop
 * or crashing - see Phase 2's "temporary API outage must not crash the
 * worker" / "heartbeat resumes automatically when API returns". `stop()` is
 * idempotent and leaves no pending timer, satisfying graceful shutdown.
 */
export class HeartbeatLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private consecutiveFailures = 0;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly deps: HeartbeatLoopDeps) {}

  start(): void {
    this.scheduleNext(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.deps.onEvent?.({ type: "loop_stopped" });
  }

  /** Exposed only so tests/shutdown can wait for an in-flight tick to settle. */
  async waitForIdle(): Promise<void> {
    await this.inFlight;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.inFlight = this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    try {
      const payload = await this.deps.buildPayload();
      const worker = await this.deps.sendHeartbeat(payload);
      this.consecutiveFailures = 0;
      this.deps.onEvent?.({ type: "heartbeat_succeeded", worker });
      this.scheduleNext(this.deps.intervalMs);
    } catch (error) {
      this.consecutiveFailures += 1;
      const nextRetryMs = nextBackoffDelayMs(this.consecutiveFailures, this.deps.backoff);
      this.deps.onEvent?.({
        type: "heartbeat_failed",
        error,
        consecutiveFailures: this.consecutiveFailures,
        nextRetryMs,
        authRejected: error instanceof UnauthorizedApiError
      });
      this.scheduleNext(nextRetryMs);
    }
  }
}
