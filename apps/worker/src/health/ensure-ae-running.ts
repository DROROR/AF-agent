import type { ProcessLister } from "../infrastructure/process-lister.js";

/**
 * Real 2026-09-12 release blocker: after every Windows restart the client
 * was being asked to open After Effects by hand before any job could run.
 * That is not an acceptable daily procedure - the Worker already starts
 * itself at logon (DYO-Worker-Setup.ps1 registers its Scheduled Task with
 * -AtLogOn, RestartCount 999), so the remaining manual step was AE itself.
 *
 * This starts AE when a job needs it and AE is genuinely not running,
 * using the SAME `AE_PATH` the setup script already validated points at a
 * real AfterFX.exe. ae-mcp's own startup poller establishes the bridge
 * once AE is up, so launching AE is the whole of what this worker needs to
 * do - it never touches ae-mcp's own panel, install, or configuration.
 *
 * Bounded by construction (CLAUDE.md rule 9 - "pause safely instead of
 * endless retries"; the user's own item 5 - "no endless restart loops"):
 *
 *   - Never launches AE when it is already running, so a healthy machine
 *     never sees a second instance.
 *   - At most ONE launch attempt per cooldown window, so a launch that
 *     does not take effect cannot become a spawn loop.
 *   - At most `maxAttempts` launches in total per worker process, after
 *     which it stops trying and reports an explicit, actionable blocked
 *     reason instead of retrying forever.
 *   - Reports every outcome honestly - it never claims AE was started when
 *     the spawn itself failed, and never infers that AE is ready merely
 *     because a launch was issued (readiness is the health probe's job,
 *     not this module's).
 */
export const DEFAULT_LAUNCH_COOLDOWN_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_LAUNCH_ATTEMPTS = 3;

export type EnsureAeRunningOutcome =
  /** AE was already running - nothing was done. */
  | { action: "already-running" }
  /** A launch was issued this call. Readiness is NOT claimed - the health probe decides that. */
  | { action: "launched"; attempt: number }
  /** Deliberately did nothing: still inside the cooldown window after a recent attempt. */
  | { action: "cooling-down"; msRemaining: number }
  /** Bounded attempt budget is spent - a human needs to look. Never retried further by this process. */
  | { action: "blocked"; reason: string }
  /** Could not even try (no AE_PATH configured, or the spawn itself failed). */
  | { action: "unavailable"; reason: string };

export interface EnsureAeRunningConfig {
  aePath: string | undefined;
  cooldownMs?: number;
  maxAttempts?: number;
}

export interface EnsureAeRunningDeps {
  processLister: ProcessLister;
  /** Launches AE detached and returns once the spawn itself succeeded - never waits for AE to become usable. */
  launchAe: (aePath: string) => Promise<void>;
  now: () => number;
}

const AFTERFX_IMAGE_NAME = "AfterFX.exe";

/**
 * Stateful across calls within one worker process - the cooldown and
 * attempt budget only mean anything if they are remembered between
 * heartbeats/jobs.
 */
export class AeLauncher {
  private readonly aePath: string | undefined;
  private readonly cooldownMs: number;
  private readonly maxAttempts: number;
  private attempts = 0;
  private lastAttemptAt: number | null = null;

  constructor(config: EnsureAeRunningConfig, private readonly deps: EnsureAeRunningDeps) {
    this.aePath = config.aePath;
    this.cooldownMs = config.cooldownMs ?? DEFAULT_LAUNCH_COOLDOWN_MS;
    this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_LAUNCH_ATTEMPTS;
  }

  /** Resets the bounded budget once AE is confirmed running again, so a later, unrelated outage still gets its own full allowance. */
  private reset(): void {
    this.attempts = 0;
    this.lastAttemptAt = null;
  }

  async ensureRunning(): Promise<EnsureAeRunningOutcome> {
    if (!this.aePath) {
      return { action: "unavailable", reason: "AE_PATH is not configured for this worker" };
    }

    const running = await this.deps.processLister.isImageRunning(AFTERFX_IMAGE_NAME);
    if (running === "RUNNING") {
      this.reset();
      return { action: "already-running" };
    }
    if (running === "UNKNOWN") {
      // Never launch on an inconclusive check - that is exactly how a
      // second AE instance gets started next to a healthy one.
      return { action: "unavailable", reason: "could not determine whether After Effects is already running" };
    }

    const now = this.deps.now();
    if (this.lastAttemptAt !== null && now - this.lastAttemptAt < this.cooldownMs) {
      return { action: "cooling-down", msRemaining: this.cooldownMs - (now - this.lastAttemptAt) };
    }
    if (this.attempts >= this.maxAttempts) {
      return {
        action: "blocked",
        reason:
          `After Effects was launched ${this.attempts} time(s) and is still not running - ` +
          "this worker will not keep retrying. A human needs to check the machine (AE failing to start, " +
          "a licensing/sign-in prompt, or a blocking dialog are the usual causes)."
      };
    }

    this.attempts += 1;
    this.lastAttemptAt = now;
    try {
      await this.deps.launchAe(this.aePath);
    } catch (error) {
      return {
        action: "unavailable",
        reason: `could not start After Effects: ${error instanceof Error ? error.message : String(error)}`
      };
    }
    return { action: "launched", attempt: this.attempts };
  }
}
