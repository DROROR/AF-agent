export interface BackoffPolicy {
  /** Delay before the first retry. */
  baseMs: number;
  /** Hard ceiling - the delay never grows past this, however many failures occur. */
  maxMs: number;
}

/**
 * Bounded exponential backoff, doubling per consecutive failure and capped at
 * `maxMs` - see docs/engineering/CODE_STANDARDS.md ("retry policy" is a rule
 * that must not be duplicated) and Phase 2's "no tight retry loop / maximum
 * retry delay" requirement. `consecutiveFailures` must be >= 1.
 */
export function nextBackoffDelayMs(consecutiveFailures: number, policy: BackoffPolicy): number {
  if (consecutiveFailures < 1) {
    throw new RangeError("consecutiveFailures must be at least 1");
  }
  const exponentialDelay = policy.baseMs * 2 ** (consecutiveFailures - 1);
  return Math.min(exponentialDelay, policy.maxMs);
}
