import { describe, expect, it, vi } from "vitest";
import type { HeartbeatLoop } from "./heartbeat-loop.js";
import { shutdownGracefully } from "./shutdown.js";

function fakeLoop(overrides: Partial<{ stop: () => void; waitForIdle: () => Promise<void> }> = {}) {
  return {
    stop: overrides.stop ?? vi.fn(),
    waitForIdle: overrides.waitForIdle ?? vi.fn(async () => {})
  } as unknown as HeartbeatLoop;
}

describe("shutdownGracefully", () => {
  it("stops the loop and waits for it to go idle before resolving, when no job is active", async () => {
    const order: string[] = [];
    const loop = fakeLoop({
      stop: vi.fn(() => order.push("stop")),
      waitForIdle: vi.fn(async () => {
        order.push("waitForIdle");
      })
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const abortActiveJob = vi.fn();

    await shutdownGracefully({
      loop,
      logger,
      hasActiveJob: () => false,
      abortActiveJob,
      getActiveJobCyclePromise: () => null
    });

    expect(order).toEqual(["stop", "waitForIdle"]);
    expect(logger.info).toHaveBeenCalled();
    expect(abortActiveJob).not.toHaveBeenCalled();
  });

  it("propagates a waitForIdle rejection rather than swallowing it silently", async () => {
    const loop = fakeLoop({ waitForIdle: vi.fn().mockRejectedValue(new Error("in-flight tick blew up")) });
    const logger = { info: vi.fn(), warn: vi.fn() };

    await expect(
      shutdownGracefully({
        loop,
        logger,
        hasActiveJob: () => false,
        abortActiveJob: vi.fn(),
        getActiveJobCyclePromise: () => null
      })
    ).rejects.toThrow("in-flight tick blew up");
  });

  it("P5 test 5: when a job is active, requests abort and waits for the tracked job-cycle promise to settle before resolving", async () => {
    const order: string[] = [];
    const loop = fakeLoop({
      stop: vi.fn(() => {
        order.push("stop");
      }),
      waitForIdle: vi.fn(async () => {
        order.push("waitForIdle");
      })
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    let resolveJobCycle: () => void = () => {};
    const jobCyclePromise = new Promise<void>((resolve) => {
      resolveJobCycle = () => {
        order.push("jobCycleSettled");
        resolve();
        return undefined;
      };
    });
    const abortActiveJob = vi.fn(async () => {
      order.push("abortActiveJob");
      // Simulate the abort itself being what unblocks the stuck job cycle,
      // matching real behavior (terminate() rejects the in-flight call).
      resolveJobCycle();
    });

    await shutdownGracefully({
      loop,
      logger,
      hasActiveJob: () => true,
      abortActiveJob,
      getActiveJobCyclePromise: () => jobCyclePromise
    });

    expect(order).toEqual(["stop", "waitForIdle", "abortActiveJob", "jobCycleSettled"]);
    expect(abortActiveJob).toHaveBeenCalledWith("worker shutdown");
  });

  it("gives up waiting (and warns) if the job cycle does not settle within the drain timeout, rather than hanging forever", async () => {
    const loop = fakeLoop();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const neverSettles = new Promise<void>(() => {});

    await shutdownGracefully({
      loop,
      logger,
      hasActiveJob: () => true,
      abortActiveJob: vi.fn(async () => {}),
      getActiveJobCyclePromise: () => neverSettles,
      jobDrainTimeoutMs: 20
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("did not settle"),
      expect.objectContaining({ timeoutMs: 20 })
    );
  });

  it("does not wait on a job cycle promise if hasActiveJob() is true but no promise is currently tracked (defensive)", async () => {
    const loop = fakeLoop();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const abortActiveJob = vi.fn(async () => {});

    await shutdownGracefully({
      loop,
      logger,
      hasActiveJob: () => true,
      abortActiveJob,
      getActiveJobCyclePromise: () => null
    });

    expect(abortActiveJob).toHaveBeenCalled();
  });
});
