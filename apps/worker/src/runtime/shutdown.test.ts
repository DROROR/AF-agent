import { describe, expect, it, vi } from "vitest";
import type { HeartbeatLoop } from "./heartbeat-loop.js";
import { shutdownGracefully } from "./shutdown.js";

describe("shutdownGracefully", () => {
  it("stops the loop and waits for it to go idle before resolving", async () => {
    const order: string[] = [];
    const loop = {
      stop: vi.fn(() => order.push("stop")),
      waitForIdle: vi.fn(async () => {
        order.push("waitForIdle");
      })
    } as unknown as HeartbeatLoop;
    const logger = { info: vi.fn() };

    await shutdownGracefully(loop, logger);

    expect(order).toEqual(["stop", "waitForIdle"]);
    expect(logger.info).toHaveBeenCalled();
  });

  it("propagates a waitForIdle rejection rather than swallowing it silently", async () => {
    const loop = {
      stop: vi.fn(),
      waitForIdle: vi.fn().mockRejectedValue(new Error("in-flight tick blew up"))
    } as unknown as HeartbeatLoop;
    const logger = { info: vi.fn() };

    await expect(shutdownGracefully(loop, logger)).rejects.toThrow("in-flight tick blew up");
  });
});
