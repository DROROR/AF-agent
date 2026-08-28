import { describe, expect, it, vi } from "vitest";
import { installProcessSafetyNet } from "./process-safety-net.js";

function setup() {
  const listeners = new Map<string, (error: unknown) => void>();
  const fakeProcess = {
    on: vi.fn((event: "uncaughtException" | "unhandledRejection", listener: (error: unknown) => void) => {
      listeners.set(event, listener);
    })
  };
  const logger = { error: vi.fn() };
  const exit = vi.fn();
  installProcessSafetyNet({ logger, exit, process: fakeProcess });
  return { listeners, logger, exit, fakeProcess };
}

describe("installProcessSafetyNet", () => {
  it("registers exactly one handler for uncaughtException and one for unhandledRejection", () => {
    const { fakeProcess } = setup();
    expect(fakeProcess.on).toHaveBeenCalledTimes(2);
    expect(fakeProcess.on).toHaveBeenCalledWith("uncaughtException", expect.any(Function));
    expect(fakeProcess.on).toHaveBeenCalledWith("unhandledRejection", expect.any(Function));
  });

  it("logs a sanitized, NEEDS_ATTENTION message and exits with code 1 on an uncaught exception", () => {
    const { listeners, logger, exit } = setup();
    listeners.get("uncaughtException")!(new Error("boom"));

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, meta] = logger.error.mock.calls[0]!;
    expect(message).toMatch(/NEEDS_ATTENTION/);
    expect(message).toMatch(/exception/);
    expect(meta).toEqual({ error: "boom" });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("logs and exits on an unhandled promise rejection, distinguishing it from an uncaught exception", () => {
    const { listeners, logger, exit } = setup();
    listeners.get("unhandledRejection")!(new Error("rejected"));

    const [message] = logger.error.mock.calls[0]!;
    expect(message).toMatch(/NEEDS_ATTENTION/);
    expect(message).toMatch(/promise rejection/);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("handles a non-Error rejection reason without throwing", () => {
    const { listeners, logger, exit } = setup();
    expect(() => listeners.get("unhandledRejection")!("a raw string reason")).not.toThrow();

    const [, meta] = logger.error.mock.calls[0]!;
    expect(meta).toEqual({ error: "a raw string reason" });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
