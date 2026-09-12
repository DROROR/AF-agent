/**
 * A promise that never settles is indistinguishable from a promise that is
 * merely slow - and in a long-lived supervisor loop the two have opposite
 * consequences: the slow one recovers, the stalled one silently ends the
 * loop forever. Every `await` on the worker's liveness path therefore needs
 * its own ceiling that does not depend on the awaited code cooperating.
 *
 * REAL 2026-09-12 INCIDENT (FAHADNAKASH, job df76c2be): worker.log's last
 * line was a successful heartbeat at 14:19:49Z. The process kept running,
 * but it never emitted another line and the API never received another
 * request from it - not a heartbeat, not a claim - for the rest of the
 * session. The heartbeat loop only ever re-armed its timer AFTER its awaits
 * settled, so one non-settling await left the worker alive-but-inert with
 * nothing to log and nothing to retry. See heartbeat-loop.ts.
 */
export class DeadlineExceededError extends Error {
  constructor(
    readonly operation: string,
    readonly deadlineMs: number
  ) {
    super(`${operation} did not settle within ${deadlineMs}ms`);
    this.name = "DeadlineExceededError";
  }
}

/**
 * Runs `run()` and rejects with DeadlineExceededError if it has not settled
 * within `deadlineMs`.
 *
 * The underlying work is NOT cancelled - this cannot forcibly reclaim a
 * socket or a child process, and pretending otherwise would be a lie. What
 * it guarantees is that the CALLER regains control on a bounded schedule,
 * which is what a supervising loop actually needs. The abandoned promise
 * keeps a rejection handler attached, so a late failure can never surface as
 * an unhandledRejection (which, under Node's default, would kill the whole
 * worker process).
 */
export function withDeadline<T>(operation: string, deadlineMs: number, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (apply: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      apply();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new DeadlineExceededError(operation, deadlineMs)));
    }, deadlineMs);
    // A race timer must never be the reason this process stays alive.
    timer.unref?.();

    let started: Promise<T>;
    try {
      // `run` is a thunk, not a promise, so a SYNCHRONOUS throw inside it is
      // caught here and reported as an ordinary rejection rather than
      // escaping past the deadline wrapper entirely.
      started = run();
    } catch (error) {
      finish(() => reject(error));
      return;
    }

    started.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}
