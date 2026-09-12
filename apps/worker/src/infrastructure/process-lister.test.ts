import { describe, expect, it } from "vitest";
import { WindowsTasklistProcessLister, type ProcessRunningStatus, type TasklistRunner } from "./process-lister.js";

/** A runner whose answers are scripted in order; the last entry repeats. */
function scriptedRunner(sequence: ProcessRunningStatus[]): { run: TasklistRunner; calls: () => number } {
  let calls = 0;
  return {
    run: async () => {
      const value = sequence[Math.min(calls, sequence.length - 1)] as ProcessRunningStatus;
      calls += 1;
      return value;
    },
    calls: () => calls
  };
}

describe("WindowsTasklistProcessLister - real 2026-09-12 incident: aeStatus flapped ONLINE -> UNKNOWN and intermittently blocked all dispatch", () => {
  it("retries once before accepting an inconclusive answer - a single slow tasklist must not decide AE's status", async () => {
    const runner = scriptedRunner(["UNKNOWN", "RUNNING"]);
    const lister = new WindowsTasklistProcessLister(() => 1_000, runner.run);

    expect(await lister.isImageRunning("AfterFX.exe")).toBe("RUNNING");
    expect(runner.calls()).toBe(2);
  });

  it("re-reports a RECENT definite observation when a fresh check cannot conclude, rather than flapping to UNKNOWN", async () => {
    let clock = 1_000;
    const runner = scriptedRunner(["RUNNING", "UNKNOWN"]);
    const lister = new WindowsTasklistProcessLister(() => clock, runner.run);

    expect(await lister.isImageRunning("AfterFX.exe")).toBe("RUNNING");
    clock += 5_000;
    // tasklist can no longer conclude, but AE demonstrably was running 5s ago.
    expect(await lister.isImageRunning("AfterFX.exe")).toBe("RUNNING");
  });

  it("NEVER invents a status indefinitely: once the reuse window passes, an inconclusive check reports UNKNOWN honestly", async () => {
    let clock = 1_000;
    const runner = scriptedRunner(["RUNNING", "UNKNOWN"]);
    const lister = new WindowsTasklistProcessLister(() => clock, runner.run);

    expect(await lister.isImageRunning("AfterFX.exe")).toBe("RUNNING");
    clock += 120_000;
    expect(await lister.isImageRunning("AfterFX.exe")).toBe("UNKNOWN");
  });

  it("a real NOT_RUNNING answer is never masked by an earlier RUNNING observation", async () => {
    let clock = 1_000;
    const runner = scriptedRunner(["RUNNING", "NOT_RUNNING"]);
    const lister = new WindowsTasklistProcessLister(() => clock, runner.run);

    expect(await lister.isImageRunning("AfterFX.exe")).toBe("RUNNING");
    clock += 1_000;
    // AE genuinely closed - reported immediately, so the launcher can restart it.
    expect(await lister.isImageRunning("AfterFX.exe")).toBe("NOT_RUNNING");
  });
});
