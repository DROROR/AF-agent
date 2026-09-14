/**
 * Durable mid-job checkpoint reporting with a small, bounded retry.
 *
 * REAL 2026-09-14 FAILURE (job e26e6ea3): after operation 1 completed, the
 * worker's checkpoint POST reached the API and was stored (HTTP 200 in ~60 ms)
 * but the response never reached the worker ("Failed to reach ..."), so the
 * whole First Preview run stopped. Re-sending the same checkpoint is
 * idempotent - it only records which operations are complete - so a lost
 * response on an unstable network is retried a few times before the executor
 * falls back to its existing "pause rather than continue with unknown durable
 * checkpoint state" behavior.
 *
 * Only errors the caller classifies as retryable (a transport failure) are
 * retried; an API refusal (e.g. the job is no longer RUNNING) is returned at
 * once, never retried into a different outcome.
 */
export interface PersistCheckpointRetryDeps {
  report: () => Promise<void>;
  isRetryable: (error: unknown) => boolean;
  /** Delays before each retry, in order - its length is the number of retries after the first attempt. */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_CHECKPOINT_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 6_000];

export type PersistCheckpointOutcome = { ok: true; attempts: number } | { ok: false; reason: string; attempts: number };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function persistCheckpointWithRetry(deps: PersistCheckpointRetryDeps): Promise<PersistCheckpointOutcome> {
  const delays = deps.retryDelaysMs ?? DEFAULT_CHECKPOINT_RETRY_DELAYS_MS;
  const sleep = deps.sleep ?? defaultSleep;
  let attempts = 0;
  for (;;) {
    attempts++;
    try {
      await deps.report();
      return { ok: true, attempts };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "checkpoint report failed";
      const delay = delays[attempts - 1];
      if (!deps.isRetryable(error) || delay === undefined) {
        return { ok: false, reason: attempts > 1 ? `${reason} (after ${attempts} attempts)` : reason, attempts };
      }
      await sleep(delay);
    }
  }
}
