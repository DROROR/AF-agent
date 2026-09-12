import type { HeartbeatRequest, WorkerDto } from "@dyo/schemas";
import type { BackoffPolicy } from "../infrastructure/backoff.js";
import { nextBackoffDelayMs } from "../infrastructure/backoff.js";
import { UnauthorizedApiError } from "../errors/worker-error.js";
import { withDeadline } from "../infrastructure/with-deadline.js";

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
  /**
   * Hard ceiling on ONE tick (buildPayload + sendHeartbeat combined). This
   * is deliberately independent of any timeout those two implement for
   * themselves: the whole point is to survive the case where a promise
   * beneath this loop never settles at all, which no inner timeout can be
   * trusted to cover (see DEFAULT_TICK_DEADLINE_MS).
   */
  tickDeadlineMs?: number;
}

/**
 * Generous relative to a healthy tick (a local process probe plus one small
 * HTTPS POST, normally well under a second) so this NEVER fires on a merely
 * slow-but-progressing heartbeat and turn a working worker into a flapping
 * one. It exists only to break a true stall.
 */
export const DEFAULT_TICK_DEADLINE_MS = 30_000;

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

  /**
   * One tick, structured so that re-arming the timer is UNCONDITIONAL.
   *
   * REAL 2026-09-12 INCIDENT (FAHADNAKASH): this method used to call
   * scheduleNext() only at the end of the try block or inside the catch. Both
   * are reachable only once the awaited promises SETTLE, so a single
   * never-settling await left the loop with no pending timer and no path back
   * - the worker process stayed alive but stopped heartbeating, stopped
   * claiming, and stopped logging entirely. The API received nothing further
   * from it (worker.log's last line was "heartbeat succeeded" at 14:19:49Z;
   * the next tick never produced any line at all, success or failure).
   *
   * Two independent guarantees now close that hole:
   *  1. the awaits run under a hard wall-clock deadline, so "never settles"
   *     becomes an ordinary, observable, retried failure; and
   *  2. the timer is re-armed BEFORE any consumer callback runs, so neither a
   *     stalled dependency nor a throwing onEvent consumer can end the loop.
   */
  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }

    let worker: WorkerDto | null = null;
    let failure: unknown = null;
    let failed = false;

    try {
      const deadlineMs = this.deps.tickDeadlineMs ?? DEFAULT_TICK_DEADLINE_MS;
      worker = await withDeadline("heartbeat tick", deadlineMs, async () => {
        const payload = await this.deps.buildPayload();
        return await this.deps.sendHeartbeat(payload);
      });
    } catch (error) {
      failed = true;
      failure = error;
    }

    let nextDelayMs: number;
    if (failed) {
      this.consecutiveFailures += 1;
      nextDelayMs = nextBackoffDelayMs(this.consecutiveFailures, this.deps.backoff);
    } else {
      this.consecutiveFailures = 0;
      nextDelayMs = this.deps.intervalMs;
    }

    // Before notifying anyone. onEvent drives real work (index.ts triggers the
    // job cycle from it), and a defect there must never cost this worker its
    // liveness.
    this.scheduleNext(nextDelayMs);

    this.emit(
      failed
        ? {
            type: "heartbeat_failed",
            error: failure,
            consecutiveFailures: this.consecutiveFailures,
            nextRetryMs: nextDelayMs,
            authRejected: failure instanceof UnauthorizedApiError
          }
        : { type: "heartbeat_succeeded", worker: worker as WorkerDto }
    );
  }

  /**
   * A consumer that throws must not reject tick(), because tick()'s promise is
   * assigned unawaited (`this.inFlight = this.tick()`) - an escaping rejection
   * would surface as an unhandledRejection and, under Node's default, take the
   * whole worker process down. The timer is already re-armed by this point, so
   * swallowing here costs observability in the consumer, never liveness.
   */
  private emit(event: HeartbeatLoopEvent): void {
    try {
      this.deps.onEvent?.(event);
    } catch {
      // Intentionally ignored - see above. Consumers own their own logging.
    }
  }
}
