import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { RealAerenderRunner, type SpawnLike } from "./aerender-runner.js";

/** A scripted child process: the test decides what it prints and when, and whether a kill ends it. */
function scriptedProcess(): { child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number; kill: (signal?: string) => boolean; killedWith: string[] } } {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 4242,
    killedWith: [] as string[],
    kill(signal?: string) {
      child.killedWith.push(signal ?? "SIGTERM");
      setTimeout(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit("close", null, signal ?? "SIGTERM");
      }, 10);
      return true;
    }
  });
  return { child };
}

const params = {
  executablePath: "C:\\\\aerender.exe",
  projectPath: "C:\\\\work\\\\copy.aep",
  compName: "Main",
  renderSettingsTemplateName: "Best Settings",
  outputModuleTemplateName: "H.264",
  outputPath: "C:\\\\work\\\\out.mp4",
  startFrame: 0,
  endFrame: 10
};

describe("RealAerenderRunner timeouts (REAL 2026-11-01: a 4K complete preview legitimately runs longer than one hour; only silence means hung)", () => {
  it("a render that keeps printing progress outlives the old flat cap and is never terminated", async () => {
    const { child } = scriptedProcess();
    const runner = new RealAerenderRunner({ spawnImpl: (() => child) as unknown as SpawnLike });
    const run = runner.run({ ...params, inactivityTimeoutMs: 120, timeoutMs: 10_000 });
    let frame = 0;
    const ticker = setInterval(() => {
      child.stdout.write(`PROGRESS: frame ${String(frame)}\n`);
      if (++frame === 8) {
        clearInterval(ticker);
        child.stdout.end();
        child.stderr.end();
        child.emit("close", 0, null);
      }
    }, 60); // 8 x 60 ms = 480 ms of output, four times the inactivity window
    const result = await run;
    expect(result.timedOut).toBe(false);
    expect(result.timedOutReason).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(child.killedWith).toEqual([]);
    expect(result.stdout).toContain("PROGRESS: frame 7");
  });

  it("a render that goes silent is terminated, and the reason names the silence", async () => {
    const { child } = scriptedProcess();
    const runner = new RealAerenderRunner({ spawnImpl: (() => child) as unknown as SpawnLike });
    const result = await runner.run({ ...params, inactivityTimeoutMs: 100, timeoutMs: 10_000 });
    expect(result.timedOut).toBe(true);
    expect(result.timedOutReason).toContain("printed nothing");
    expect(child.killedWith[0]).toBe("SIGTERM");
  });

  it("a render that prints forever still hits the absolute ceiling, and the reason names the ceiling", async () => {
    const { child } = scriptedProcess();
    const runner = new RealAerenderRunner({ spawnImpl: (() => child) as unknown as SpawnLike });
    const ticker = setInterval(() => child.stdout.write("PROGRESS\n"), 20);
    const result = await runner.run({ ...params, inactivityTimeoutMs: 1_000, timeoutMs: 150 });
    clearInterval(ticker);
    expect(result.timedOut).toBe(true);
    expect(result.timedOutReason).toContain("ceiling");
  });
});
