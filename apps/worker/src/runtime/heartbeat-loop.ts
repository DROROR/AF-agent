import type { HeartbeatRequest, WorkerDto } from "@dyo/schemas";
import type { BackoffPolicy } from "../infrastructure/backoff.js";
import { nextBackoffDelayMs } from "../infrastructure/backoff.js";

export type HeartbeatLoopEvent =
  | { type: "heartbeat_succeeded"; worker: WorkerDto }
  | { type: "heartbeat_failed"; error: unknown; consecutiveFailures: number; nextRetryMs: number }
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
        nextRetryMs
      });
      this.scheduleNext(nextRetryMs);
    }
  }
}
