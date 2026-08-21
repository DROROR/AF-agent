/**
 * Pure business rule: a worker's heartbeat is stale once more than
 * `staleAfterMs` has elapsed since it last reported in, or if it never
 * reported in at all. No I/O, no framework - kept independently testable.
 */
export function isHeartbeatStale(
  lastHeartbeatAt: Date | null,
  now: Date,
  staleAfterMs: number
): boolean {
  if (!lastHeartbeatAt) {
    return true;
  }
  return now.getTime() - lastHeartbeatAt.getTime() > staleAfterMs;
}
