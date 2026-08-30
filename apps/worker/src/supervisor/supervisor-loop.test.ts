import { describe, expect, it, vi } from "vitest";
import { createSupervisorLoop, type WorkerChildHandleLike } from "./supervisor-loop.js";

/** A controllable fake child: the test resolves its exit at will, never a real process. */
function fakeChild(pid: number): { handle: WorkerChildHandleLike; resolveExit: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void; requestStop: ReturnType<typeof vi.fn> } {
  let resolveExit!: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveExit = resolve;
  });
  const requestStop = vi.fn();
  return { handle: { pid, exited, requestStop }, resolveExit, requestStop };
}

function fakeLogger() {
  return { info: vi.fn() };
}

/**
 * Resolves via a real macrotask (setTimeout(0)), never a bare
 * Promise.resolve() - a maintenance-poll loop awaiting an
 * already-resolved promise in a tight `while` loop starves the event
 * loop's macrotask queue entirely (nothing - including a test's own
 * `setTimeout` wait - ever gets to run), which previously produced a real
 * OOM here. Still effectively instant for test purposes.
 */
function fakeSleep(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return {
    sleep: (ms: number) => {
      calls.push(ms);
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
    calls
  };
}

describe("createSupervisorLoop", () => {
  it("crash -> restart: a worker child exiting with a nonzero code triggers a fresh spawn (never leaves the worker stopped)", async () => {
    const first = fakeChild(100);
    const second = fakeChild(200);
    const spawnChild = vi.fn().mockReturnValueOnce(first.handle).mockReturnValueOnce(second.handle);
    const { sleep } = fakeSleep();
    const loop = createSupervisorLoop({ spawnChild, isMaintenanceActive: () => false, sleep, logger: fakeLogger(), buildInfo: null });

    const runPromise = loop.run();
    first.resolveExit({ code: 1, signal: null });
    await vi.waitFor(() => expect(spawnChild).toHaveBeenCalledTimes(2));

    second.resolveExit({ code: 0, signal: null });
    loop.stop();
    await runPromise;
  });

  it("a zero exit code still restarts (an ordinary/unexpected process end, not a requested stop) unless stop() was called", async () => {
    const first = fakeChild(100);
    const second = fakeChild(200);
    const spawnChild = vi.fn().mockReturnValueOnce(first.handle).mockReturnValueOnce(second.handle);
    const { sleep } = fakeSleep();
    const loop = createSupervisorLoop({ spawnChild, isMaintenanceActive: () => false, sleep, logger: fakeLogger(), buildInfo: null });

    const runPromise = loop.run();
    first.resolveExit({ code: 0, signal: null });
    await vi.waitFor(() => expect(spawnChild).toHaveBeenCalledTimes(2));

    loop.stop();
    second.resolveExit({ code: 0, signal: null });
    await runPromise;
  });

  it("SIGBREAK/SIGHUP-style external-interruption exits (a nonzero, non-zero-signal exit) are observed and still trigger a restart", async () => {
    const first = fakeChild(100);
    const second = fakeChild(200);
    const spawnChild = vi.fn().mockReturnValueOnce(first.handle).mockReturnValueOnce(second.handle);
    const logger = fakeLogger();
    const { sleep } = fakeSleep();
    const loop = createSupervisorLoop({ spawnChild, isMaintenanceActive: () => false, sleep, logger, buildInfo: null });

    const runPromise = loop.run();
    // Exit code 2 mirrors signal-handlers.ts's EXTERNAL_INTERRUPTION_EXIT_CODE.
    first.resolveExit({ code: 2, signal: null });
    await vi.waitFor(() => expect(spawnChild).toHaveBeenCalledTimes(2));
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ exit: { code: 2, signal: null } }), "worker child exited");

    loop.stop();
    second.resolveExit({ code: 0, signal: null });
    await runPromise;
  });

  it("maintenance active at spawn time: never spawns a child at all, just waits", async () => {
    const spawnChild = vi.fn();
    const { sleep, calls } = fakeSleep();
    let maintenanceActive = true;
    const loop = createSupervisorLoop({
      spawnChild,
      isMaintenanceActive: () => maintenanceActive,
      sleep,
      logger: fakeLogger(),
      buildInfo: null,
      maintenancePollMs: 2000
    });

    const runPromise = loop.run();
    await vi.waitFor(() => expect(calls).toContain(2000));
    expect(spawnChild).not.toHaveBeenCalled();

    maintenanceActive = false;
    loop.stop();
    await runPromise;
    expect(spawnChild).not.toHaveBeenCalled();
  });

  it("maintenance becomes active exactly as a child dies: does not restart, and never spawns again until maintenance clears and stop() has not been called", async () => {
    const first = fakeChild(100);
    const spawnChild = vi.fn().mockReturnValueOnce(first.handle);
    const { sleep } = fakeSleep();
    let maintenanceActive = false;
    const loop = createSupervisorLoop({ spawnChild, isMaintenanceActive: () => maintenanceActive, sleep, logger: fakeLogger(), buildInfo: null });

    const runPromise = loop.run();
    maintenanceActive = true; // updater set the flag right before this child happened to exit on its own
    first.resolveExit({ code: 1, signal: null });

    // Give the loop a moment to process the exit and decide - it must NOT spawn a second child while maintenance is active.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spawnChild).toHaveBeenCalledTimes(1);

    loop.stop();
    await runPromise;
    expect(spawnChild).toHaveBeenCalledTimes(1);
  });

  it("stop() forwards requestStop() to the currently-running child immediately", async () => {
    const first = fakeChild(100);
    const spawnChild = vi.fn().mockReturnValueOnce(first.handle);
    const { sleep } = fakeSleep();
    const loop = createSupervisorLoop({ spawnChild, isMaintenanceActive: () => false, sleep, logger: fakeLogger(), buildInfo: null });

    const runPromise = loop.run();
    await vi.waitFor(() => expect(spawnChild).toHaveBeenCalledTimes(1));
    loop.stop();
    expect(first.requestStop).toHaveBeenCalledTimes(1);

    first.resolveExit({ code: 0, signal: null });
    await runPromise;
    expect(spawnChild).toHaveBeenCalledTimes(1);
  });

  it("stop() called while no child is running (mid maintenance-wait) still winds the loop down without ever spawning", async () => {
    const spawnChild = vi.fn();
    const { sleep } = fakeSleep();
    const loop = createSupervisorLoop({ spawnChild, isMaintenanceActive: () => true, sleep, logger: fakeLogger(), buildInfo: null });

    const runPromise = loop.run();
    await new Promise((resolve) => setTimeout(resolve, 10));
    loop.stop();
    await runPromise;

    expect(spawnChild).not.toHaveBeenCalled();
  });

  it("threads previousPid/previousExit into the next 'started a new worker child' log line - real diagnostic value across a restart", async () => {
    const first = fakeChild(111);
    const second = fakeChild(222);
    const spawnChild = vi.fn().mockReturnValueOnce(first.handle).mockReturnValueOnce(second.handle);
    const logger = fakeLogger();
    const { sleep } = fakeSleep();
    const loop = createSupervisorLoop({ spawnChild, isMaintenanceActive: () => false, sleep, logger, buildInfo: { commit: "abc123" } });

    const runPromise = loop.run();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ previousPid: null, newPid: 111, restartCount: 0, previousExit: null, buildInfo: { commit: "abc123" } }),
      "supervisor started a new worker child"
    );

    first.resolveExit({ code: 1, signal: null });
    await vi.waitFor(() => expect(spawnChild).toHaveBeenCalledTimes(2));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ previousPid: 111, newPid: 222, restartCount: 1, previousExit: { code: 1, signal: null } }),
      "supervisor started a new worker child"
    );

    loop.stop();
    second.resolveExit({ code: 0, signal: null });
    await runPromise;
  });

  it("passes a growing bounded backoff to sleep() across consecutive ordinary crashes (restart-policy.ts's own computeBackoffMs sequence)", async () => {
    const first = fakeChild(1);
    const second = fakeChild(2);
    const third = fakeChild(3);
    const spawnChild = vi
      .fn()
      .mockReturnValueOnce(first.handle)
      .mockReturnValueOnce(second.handle)
      .mockReturnValueOnce(third.handle);
    const { sleep, calls } = fakeSleep();
    const loop = createSupervisorLoop({ spawnChild, isMaintenanceActive: () => false, sleep, logger: fakeLogger(), buildInfo: null });

    const runPromise = loop.run();
    first.resolveExit({ code: 1, signal: null });
    await vi.waitFor(() => expect(spawnChild).toHaveBeenCalledTimes(2));
    second.resolveExit({ code: 1, signal: null });
    await vi.waitFor(() => expect(spawnChild).toHaveBeenCalledTimes(3));

    expect(calls).toEqual([2_000, 4_000]);

    loop.stop();
    third.resolveExit({ code: 0, signal: null });
    await runPromise;
  });
});
