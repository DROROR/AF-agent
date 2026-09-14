import { describe, expect, it } from "vitest";
import { persistCheckpointWithRetry } from "./persist-checkpoint-with-retry.js";

class TransportError extends Error {}
const noSleep = async () => {};

describe("persistCheckpointWithRetry (real 2026-09-14: a stored checkpoint whose response was lost stopped First Preview)", () => {
  it("succeeds on the first attempt without waiting", async () => {
    let calls = 0;
    const slept: number[] = [];
    const outcome = await persistCheckpointWithRetry({ report: async () => { calls++; }, isRetryable: () => true, sleep: async (ms) => { slept.push(ms); } });
    expect(outcome).toEqual({ ok: true, attempts: 1 });
    expect(calls).toBe(1);
    expect(slept).toEqual([]);
  });

  it("retries a lost-response transport failure with the bounded backoff, then succeeds", async () => {
    let calls = 0;
    const slept: number[] = [];
    const outcome = await persistCheckpointWithRetry({
      report: async () => {
        calls++;
        if (calls < 3) throw new TransportError("Failed to reach /api/workers/w/jobs/j/checkpoint");
      },
      isRetryable: (error) => error instanceof TransportError,
      retryDelaysMs: [1_000, 3_000, 6_000],
      sleep: async (ms) => { slept.push(ms); }
    });
    expect(outcome).toEqual({ ok: true, attempts: 3 });
    expect(slept).toEqual([1_000, 3_000]);
  });

  it("gives up after the bounded retries and reports how many attempts were made - the executor then pauses safely", async () => {
    let calls = 0;
    const outcome = await persistCheckpointWithRetry({
      report: async () => { calls++; throw new TransportError("Failed to reach"); },
      isRetryable: (error) => error instanceof TransportError,
      retryDelaysMs: [10, 20],
      sleep: noSleep
    });
    expect(calls).toBe(3);
    expect(outcome).toEqual({ ok: false, reason: "Failed to reach (after 3 attempts)", attempts: 3 });
  });

  it("never retries an API refusal (e.g. the job is no longer RUNNING)", async () => {
    let calls = 0;
    const outcome = await persistCheckpointWithRetry({
      report: async () => { calls++; throw new Error("CONFLICT: job is not RUNNING"); },
      isRetryable: (error) => error instanceof TransportError,
      sleep: noSleep
    });
    expect(calls).toBe(1);
    expect(outcome).toEqual({ ok: false, reason: "CONFLICT: job is not RUNNING", attempts: 1 });
  });
});
