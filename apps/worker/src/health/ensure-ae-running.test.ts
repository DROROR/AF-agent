import { describe, expect, it, vi } from "vitest";
import { AeLauncher } from "./ensure-ae-running.js";
import type { ProcessLister } from "../infrastructure/process-lister.js";

function lister(sequence: Array<"RUNNING" | "NOT_RUNNING" | "UNKNOWN">): ProcessLister {
  let i = 0;
  return {
    isImageRunning: async () => sequence[Math.min(i++, sequence.length - 1)] as "RUNNING" | "NOT_RUNNING" | "UNKNOWN"
  } as ProcessLister;
}

const AE_PATH = "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.exe";

describe("AeLauncher - real 2026-09-12 release blocker: the client must never be asked to open After Effects by hand after a restart", () => {
  it("COLD BOOT: starts After Effects when it is genuinely not running", async () => {
    const launchAe = vi.fn(async () => {});
    const launcher = new AeLauncher({ aePath: AE_PATH }, { processLister: lister(["NOT_RUNNING"]), launchAe, now: () => 0 });

    const outcome = await launcher.ensureRunning();

    expect(outcome).toEqual({ action: "launched", attempt: 1 });
    expect(launchAe).toHaveBeenCalledWith(AE_PATH);
  });

  it("never starts a second instance when After Effects is already running", async () => {
    const launchAe = vi.fn(async () => {});
    const launcher = new AeLauncher({ aePath: AE_PATH }, { processLister: lister(["RUNNING"]), launchAe, now: () => 0 });

    expect(await launcher.ensureRunning()).toEqual({ action: "already-running" });
    expect(launchAe).not.toHaveBeenCalled();
  });

  it("never launches on an inconclusive process check - that is how a duplicate AE gets started next to a healthy one", async () => {
    const launchAe = vi.fn(async () => {});
    const launcher = new AeLauncher({ aePath: AE_PATH }, { processLister: lister(["UNKNOWN"]), launchAe, now: () => 0 });

    const outcome = await launcher.ensureRunning();

    expect(outcome.action).toBe("unavailable");
    expect(launchAe).not.toHaveBeenCalled();
  });

  it("DELAYED AE STARTUP: does not launch again while AE is still coming up - one attempt per cooldown window, never a spawn loop", async () => {
    const launchAe = vi.fn(async () => {});
    let clock = 0;
    const launcher = new AeLauncher(
      { aePath: AE_PATH, cooldownMs: 60_000 },
      { processLister: lister(["NOT_RUNNING"]), launchAe, now: () => clock }
    );

    expect((await launcher.ensureRunning()).action).toBe("launched");
    clock += 5_000; // AE is still starting - the process is not up yet.
    const second = await launcher.ensureRunning();

    expect(second.action).toBe("cooling-down");
    expect(launchAe).toHaveBeenCalledTimes(1);
  });

  it("NO ENDLESS LOOP: stops after a bounded number of launches and reports an explicit, actionable blocked reason", async () => {
    const launchAe = vi.fn(async () => {});
    let clock = 0;
    const launcher = new AeLauncher(
      { aePath: AE_PATH, cooldownMs: 1_000, maxAttempts: 2 },
      { processLister: lister(["NOT_RUNNING"]), launchAe, now: () => clock }
    );

    expect((await launcher.ensureRunning()).action).toBe("launched");
    clock += 2_000;
    expect((await launcher.ensureRunning()).action).toBe("launched");
    clock += 2_000;
    const blocked = await launcher.ensureRunning();

    expect(blocked.action).toBe("blocked");
    if (blocked.action !== "blocked") return;
    expect(blocked.reason).toMatch(/will not keep retrying/);
    // A human-actionable cause is named rather than left as a bare failure.
    expect(blocked.reason).toMatch(/licensing|sign-in|dialog/i);
    expect(launchAe).toHaveBeenCalledTimes(2);
  });

  it("gives a later, unrelated outage its own full attempt budget once AE has been seen running again", async () => {
    const launchAe = vi.fn(async () => {});
    let clock = 0;
    const launcher = new AeLauncher(
      { aePath: AE_PATH, cooldownMs: 1_000, maxAttempts: 1 },
      { processLister: lister(["NOT_RUNNING", "RUNNING", "NOT_RUNNING"]), launchAe, now: () => clock }
    );

    expect((await launcher.ensureRunning()).action).toBe("launched");
    clock += 2_000;
    expect((await launcher.ensureRunning()).action).toBe("already-running");
    clock += 2_000;
    // Budget was reset by the confirmed-running observation, so this is a
    // real launch rather than an immediate "blocked".
    expect((await launcher.ensureRunning()).action).toBe("launched");
    expect(launchAe).toHaveBeenCalledTimes(2);
  });

  it("never claims AE was started when the spawn itself failed", async () => {
    const launcher = new AeLauncher(
      { aePath: AE_PATH },
      {
        processLister: lister(["NOT_RUNNING"]),
        launchAe: async () => {
          throw new Error("EACCES");
        },
        now: () => 0
      }
    );

    const outcome = await launcher.ensureRunning();

    expect(outcome.action).toBe("unavailable");
    if (outcome.action !== "unavailable") return;
    expect(outcome.reason).toContain("EACCES");
  });

  it("reports unavailable, and never launches anything, when AE_PATH is not configured", async () => {
    const launchAe = vi.fn(async () => {});
    const launcher = new AeLauncher({ aePath: undefined }, { processLister: lister(["NOT_RUNNING"]), launchAe, now: () => 0 });

    expect((await launcher.ensureRunning()).action).toBe("unavailable");
    expect(launchAe).not.toHaveBeenCalled();
  });
});
