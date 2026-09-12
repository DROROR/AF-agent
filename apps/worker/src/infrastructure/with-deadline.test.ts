import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeadlineExceededError, withDeadline } from "./with-deadline.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withDeadline", () => {
  it("resolves with the value when the work settles in time", async () => {
    const promise = withDeadline("op", 1000, async () => "done");
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBe("done");
  });

  it("rejects with DeadlineExceededError when the work NEVER settles", async () => {
    // The exact 2026-09-12 shape: a promise that is not slow, but dead.
    const promise = withDeadline("heartbeat tick", 30_000, () => new Promise<string>(() => {}));
    const caught = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(30_000);

    const error = await caught;
    expect(error).toBeInstanceOf(DeadlineExceededError);
    expect((error as DeadlineExceededError).operation).toBe("heartbeat tick");
    expect((error as Error).message).toContain("30000ms");
  });

  it("propagates the real rejection rather than masking it as a deadline", async () => {
    const promise = withDeadline("op", 1000, async () => {
      throw new Error("real cause");
    });
    const caught = promise.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect((await caught) as Error).toHaveProperty("message", "real cause");
  });

  it("reports a SYNCHRONOUS throw from the thunk as an ordinary rejection", async () => {
    const promise = withDeadline("op", 1000, () => {
      throw new Error("threw before returning a promise");
    });
    await expect(promise).rejects.toThrow("threw before returning a promise");
  });

  it("does not resolve twice when the abandoned work settles after the deadline", async () => {
    let release: (value: string) => void = () => {};
    const promise = withDeadline("op", 1000, () => new Promise<string>((resolve) => (release = resolve)));
    const outcome = promise.then(
      (value) => ({ status: "resolved" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error })
    );

    await vi.advanceTimersByTimeAsync(1000);
    release("late value");
    await vi.advanceTimersByTimeAsync(0);

    expect((await outcome).status).toBe("rejected");
  });

  it("never lets a LATE rejection from abandoned work escape as an unhandled rejection", async () => {
    let fail: (error: Error) => void = () => {};
    const promise = withDeadline("op", 1000, () => new Promise<string>((_resolve, reject) => (fail = reject)));
    const caught = promise.catch(() => "handled");

    await vi.advanceTimersByTimeAsync(1000);
    expect(await caught).toBe("handled");

    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    fail(new Error("late failure from the abandoned call"));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    process.off("unhandledRejection", unhandled);

    expect(unhandled).not.toHaveBeenCalled();
  });
});
