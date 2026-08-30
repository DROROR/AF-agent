import { describe, expect, it, vi } from "vitest";
import { EXTERNAL_INTERRUPTION_EXIT_CODE, installSignalHandlers, type ObservedSignal } from "./signal-handlers.js";

function fakeLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

/** Captures every `on(signal, listener)` registration so a test can fire one directly, without a real process-wide listener. */
function fakeOn(): { on: (event: ObservedSignal, listener: () => void) => void; fire: (event: ObservedSignal) => void } {
  const listeners = new Map<ObservedSignal, () => void>();
  return {
    on: (event, listener) => listeners.set(event, listener),
    fire: (event) => {
      const listener = listeners.get(event);
      if (!listener) throw new Error(`no listener registered for ${event}`);
      listener();
    }
  };
}

describe("installSignalHandlers", () => {
  it("registers all four signals", () => {
    const { on } = fakeOn();
    const onSpy = vi.fn(on);
    installSignalHandlers({ logger: fakeLogger(), shutdownGracefully: () => Promise.resolve(), exit: vi.fn(), on: onSpy });
    const registered = onSpy.mock.calls.map(([event]) => event);
    expect(registered).toEqual(["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]);
  });

  it("SIGINT runs graceful shutdown then exits 0 - an intentional stop", async () => {
    const { on, fire } = fakeOn();
    const exit = vi.fn();
    const logger = fakeLogger();
    const shutdownGracefully = vi.fn().mockResolvedValue(undefined);
    installSignalHandlers({ logger, shutdownGracefully, exit, on });

    fire("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(shutdownGracefully).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ signal: "SIGINT" }, "received shutdown signal");
  });

  it("SIGTERM runs graceful shutdown then exits 0 - the supervisor's own controlled stop signal", async () => {
    const { on, fire } = fakeOn();
    const exit = vi.fn();
    installSignalHandlers({ logger: fakeLogger(), shutdownGracefully: () => Promise.resolve(), exit, on });

    fire("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it("SIGBREAK still runs graceful shutdown but exits with EXTERNAL_INTERRUPTION_EXIT_CODE, never 0 - never confused with an intentional stop", async () => {
    const { on, fire } = fakeOn();
    const exit = vi.fn();
    const logger = fakeLogger();
    const shutdownGracefully = vi.fn().mockResolvedValue(undefined);
    installSignalHandlers({ logger, shutdownGracefully, exit, on });

    fire("SIGBREAK");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(EXTERNAL_INTERRUPTION_EXIT_CODE));
    expect(EXTERNAL_INTERRUPTION_EXIT_CODE).not.toBe(0);
    expect(shutdownGracefully).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { signal: "SIGBREAK" },
      "received an external interruption signal (Ctrl+Break) - this was not a requested stop"
    );
  });

  it("SIGHUP still runs graceful shutdown but exits with EXTERNAL_INTERRUPTION_EXIT_CODE, never 0", async () => {
    const { on, fire } = fakeOn();
    const exit = vi.fn();
    const logger = fakeLogger();
    installSignalHandlers({ logger, shutdownGracefully: () => Promise.resolve(), exit, on });

    fire("SIGHUP");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(EXTERNAL_INTERRUPTION_EXIT_CODE));
    expect(logger.info).toHaveBeenCalledWith(
      { signal: "SIGHUP" },
      "received an external interruption signal (console closed) - this was not a requested stop"
    );
  });

  it("is idempotent - a second signal after shutdown has started is ignored, never double-shuts-down", async () => {
    const { on, fire } = fakeOn();
    const exit = vi.fn();
    const shutdownGracefully = vi.fn().mockResolvedValue(undefined);
    installSignalHandlers({ logger: fakeLogger(), shutdownGracefully, exit, on });

    fire("SIGINT");
    fire("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
    expect(shutdownGracefully).toHaveBeenCalledTimes(1);
  });

  it("exits 1 (never crashes the process) if shutdownGracefully itself rejects", async () => {
    const { on, fire } = fakeOn();
    const exit = vi.fn();
    const logger = fakeLogger();
    installSignalHandlers({
      logger,
      shutdownGracefully: () => Promise.reject(new Error("heartbeat loop wedged")),
      exit,
      on
    });

    fire("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(logger.error).toHaveBeenCalledWith(
      { error: "heartbeat loop wedged", signal: "SIGINT" },
      "error during shutdown"
    );
  });
});
