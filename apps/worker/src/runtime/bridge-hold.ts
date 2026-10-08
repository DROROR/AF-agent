/**
 * Who is using the After Effects bridge right now - a job, or nobody.
 *
 * REAL 2026-10-08 (client PC, frame builds a6434832 and a85dd7d1). The bridge
 * keeps ONE command file and ONE result file per After Effects instance and
 * serialises callers only inside one ae-mcp process. This worker talks to it
 * from two kinds of process: the one a job starts, and the one the heartbeat's
 * health probe starts every few minutes. Nothing kept them apart, so a probe
 * that began while a job's command was waiting to be read overwrote it, and
 * the job failed thirty seconds later with the bridge's own AE_TIMEOUT - at a
 * different operation each time, with After Effects perfectly alive.
 *
 * The rule this holds: while a job runs, no probe starts
 * (ae-mcp-round-trip-adapter.ts reads `isHeld`); and a job does not touch the
 * bridge until a probe already running has finished (`run` awaits it after
 * raising the flag, so no new probe can slip in between the two).
 *
 * A counter, not a boolean, so it stays correct if two holders ever overlap.
 */
export class BridgeHold {
  private holders = 0;

  isHeld(): boolean {
    return this.holders > 0;
  }

  /**
   * Runs `work` holding the bridge. The flag goes up first, then the probe
   * that may already be running is waited for, then the work runs. The hold
   * is released whatever happens, including when `waitForRunningProbe` or
   * `work` throws.
   */
  async run<T>(waitForRunningProbe: () => Promise<void>, work: () => Promise<T>): Promise<T> {
    this.holders += 1;
    try {
      await waitForRunningProbe();
      return await work();
    } finally {
      this.holders -= 1;
    }
  }
}
