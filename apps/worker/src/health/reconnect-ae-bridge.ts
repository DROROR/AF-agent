/**
 * Bounded, automatic recovery for a live-but-unregistered ae-mcp bridge.
 *
 * REAL 2026-09-12 INCIDENT (FAHADNAKASH, worker accd0a71). After the worker
 * started After Effects itself, the round-trip probe reported
 * `bridge-not-connected` on 12 consecutive probes across 5 minutes and never
 * self-healed. CHECK_HEALTH captured ae-mcp's own verdict verbatim:
 *
 *   Ensure: { "ok": false, "kicked": false, "skipped": true,
 *             "aeRunning": true, "instances": 0,
 *             "message": "No live bridge heartbeat. Restart After Effects
 *                         once so Startup/ae-mcp-bootstrap.jsx loads
 *                         (silent). Or run ae_reconnect once if AE is
 *                         already up." }
 *
 * AE was running; its Startup bootstrap had simply not loaded into that AE
 * process, so no instance ever registered. ae-mcp's OWN ensure step declined
 * to act (`skipped: true`), which is exactly why repeated probing could never
 * fix it - the probe was faithfully reporting a real, stable, unrecoverable-
 * by-probing state.
 *
 * ae-mcp names `ae_reconnect` as the supported in-place fix. It was not in
 * this worker's tool allowlist, so the only remaining option was a human
 * restarting After Effects. This module closes that gap.
 *
 * WHY THIS IS SAFE, and why it is not "just retry harder":
 *  - `ae_reconnect` re-registers the bridge inside an ALREADY-RUNNING AE. It
 *    does not start, stop, or kill After Effects, and it never touches a
 *    project. Nothing unsaved can be lost by it - which is precisely why it
 *    is preferred over the "restart After Effects" alternative in the same
 *    message.
 *  - It is attempted ONLY on `bridge-not-connected`: a positively confirmed
 *    OFFLINE answer from a bridge that responded. It is never attempted on an
 *    inconclusive probe, a timeout, or a transport error, because those carry
 *    no evidence that reconnecting is the right action.
 *  - It is bounded exactly like AeLauncher: one attempt per cooldown window
 *    and a capped total, after which it reports an explicit actionable
 *    outcome instead of retrying forever (CLAUDE.md Safety Rule 9, "pause
 *    safely instead of endless retries").
 *  - The budget resets the moment the bridge is confirmed connected, so a
 *    later, unrelated disconnect gets a fresh budget rather than inheriting
 *    an exhausted one.
 */

/** One attempt per this window. Generous: a genuine reconnect settles in seconds, and hammering a bridge that cannot register helps nothing. */
export const DEFAULT_RECONNECT_COOLDOWN_MS = 2 * 60 * 1000;
/** After this many attempts without a confirmed connection, stop and report. A human genuinely needs to look. */
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;

export type BridgeReconnectAction =
  /** The bridge was already connected - nothing was attempted. */
  | "not-needed"
  /** ae_reconnect was called and reported success. The next probe confirms whether it actually took. */
  | "reconnected"
  /** ae_reconnect was called and failed, or returned an unusable answer. */
  | "attempt-failed"
  /** Within the cooldown window since the last attempt. */
  | "cooling-down"
  /** The bounded attempt budget is spent. A human needs to restart After Effects. */
  | "blocked"
  /** No reconnect transport is wired (e.g. no AE_MCP_PATH configured). */
  | "unavailable";

export interface BridgeReconnectOutcome {
  action: BridgeReconnectAction;
  attempt: number;
  detail: string;
}

export interface ReconnectAeBridgeDeps {
  /**
   * Calls ae-mcp's `ae_reconnect` tool. Returns whether it reported success.
   * Injected so the bounded decision logic is testable with no ae-mcp, no AE,
   * and no Windows.
   */
  callReconnect: () => Promise<{ ok: boolean; detail: string }>;
  now: () => number;
  cooldownMs?: number;
  maxAttempts?: number;
  logger?: { info: (details: Record<string, unknown>, message: string) => void; warn: (details: Record<string, unknown>, message: string) => void };
}

export class AeBridgeReconnector {
  private attempts = 0;
  private lastAttemptAt: number | null = null;

  constructor(private readonly deps: ReconnectAeBridgeDeps) {}

  private get cooldownMs(): number {
    return this.deps.cooldownMs ?? DEFAULT_RECONNECT_COOLDOWN_MS;
  }

  private get maxAttempts(): number {
    return this.deps.maxAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
  }

  /**
   * Called when a probe positively confirms the bridge IS connected. Resets
   * the budget so a future, unrelated disconnect is not refused because of
   * attempts spent on an earlier one.
   */
  noteBridgeConnected(): void {
    this.attempts = 0;
    this.lastAttemptAt = null;
  }

  /** Called ONLY for a confirmed `bridge-not-connected` answer - never for an inconclusive probe. */
  async reconnect(): Promise<BridgeReconnectOutcome> {
    const now = this.deps.now();

    if (this.attempts >= this.maxAttempts) {
      const outcome: BridgeReconnectOutcome = {
        action: "blocked",
        attempt: this.attempts,
        detail:
          `ae_reconnect was attempted ${this.attempts} time(s) without the bridge coming up. ` +
          `After Effects is running but its Startup/ae-mcp-bootstrap.jsx has not registered an instance. ` +
          `OPERATOR ACTION: fully quit and reopen After Effects so the startup bootstrap loads.`
      };
      this.deps.logger?.warn({ reconnect: outcome }, "ae-mcp bridge could not be reconnected automatically");
      return outcome;
    }

    if (this.lastAttemptAt !== null && now - this.lastAttemptAt < this.cooldownMs) {
      const waitMs = this.cooldownMs - (now - this.lastAttemptAt);
      return {
        action: "cooling-down",
        attempt: this.attempts,
        detail: `waiting ${Math.ceil(waitMs / 1000)}s before another ae_reconnect attempt`
      };
    }

    this.attempts += 1;
    this.lastAttemptAt = now;

    let result: { ok: boolean; detail: string };
    try {
      result = await this.deps.callReconnect();
    } catch (error) {
      const outcome: BridgeReconnectOutcome = {
        action: "attempt-failed",
        attempt: this.attempts,
        detail: error instanceof Error ? error.message : "ae_reconnect threw"
      };
      this.deps.logger?.warn({ reconnect: outcome }, "ae_reconnect attempt failed");
      return outcome;
    }

    const outcome: BridgeReconnectOutcome = {
      action: result.ok ? "reconnected" : "attempt-failed",
      attempt: this.attempts,
      detail: result.detail
    };
    if (result.ok) {
      // Deliberately NOT reported as ONLINE here. Only the next real probe
      // can confirm the bridge actually registered - claiming success from
      // the reconnect call alone would be exactly the false-ONLINE this
      // codebase has repeatedly refused to emit.
      this.deps.logger?.info({ reconnect: outcome }, "ae_reconnect reported success - the next probe will confirm");
    } else {
      this.deps.logger?.warn({ reconnect: outcome }, "ae_reconnect did not report success");
    }
    return outcome;
  }
}
