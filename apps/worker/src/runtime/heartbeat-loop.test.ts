import type { HeartbeatRequest, WorkerDto } from "@dyo/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeartbeatLoop, type HeartbeatLoopEvent } from "./heartbeat-loop.js";
import { ApiResponseError, UnauthorizedApiError } from "../errors/worker-error.js";

const payload: HeartbeatRequest = {
  aeStatus: "UNKNOWN",
  mcpStatus: "UNKNOWN",
  aeVersion: null,
  currentJobId: null
};

const workerDto = {
  workerId: "11111111-1111-1111-1111-111111111111",
  name: "worker-a",
  status: "ONLINE",
  lastHeartbeatAt: new Date().toISOString(),
  aeStatus: "UNKNOWN",
  mcpStatus: "UNKNOWN",
  aeVersion: null,
  capabilities: ["CHECK_HEALTH"],
  maxConcurrency: 1,
  currentJobId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
} as WorkerDto;

const backoff = { baseMs: 1000, maxMs: 8000 };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HeartbeatLoop", () => {
  it("sends an initial heartbeat as soon as it starts", async () => {
    const sendHeartbeat = vi.fn().mockResolvedValue(workerDto);
    const events: HeartbeatLoopEvent[] = [];
    const loop = new HeartbeatLoop({
      buildPayload: async () => payload,
      sendHeartbeat,
      intervalMs: 5000,
      backoff,
      onEvent: (event) => events.push(event)
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(sendHeartbeat).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: "heartbeat_succeeded", worker: workerDto }]);
  });

  it("resumes the normal interval after a successful heartbeat", async () => {
    const sendHeartbeat = vi.fn().mockResolvedValue(workerDto);
    const loop = new HeartbeatLoop({
      buildPayload: async () => payload,
      sendHeartbeat,
      intervalMs: 5000,
      backoff
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendHeartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendHeartbeat).toHaveBeenCalledTimes(2);
  });

  it("does not crash on a temporary outage and recovers automatically once the API returns", async () => {
    const sendHeartbeat = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(workerDto);
    const events: HeartbeatLoopEvent[] = [];
    const loop = new HeartbeatLoop({
      buildPayload: async () => payload,
      sendHeartbeat,
      intervalMs: 5000,
      backoff,
      onEvent: (event) => events.push(event)
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(0); // attempt 1: fails
    await vi.advanceTimersByTimeAsync(backoff.baseMs); // attempt 2: fails
    await vi.advanceTimersByTimeAsync(backoff.baseMs * 2); // attempt 3: succeeds

    expect(sendHeartbeat).toHaveBeenCalledTimes(3);
    expect(events.map((e) => e.type)).toEqual([
      "heartbeat_failed",
      "heartbeat_failed",
      "heartbeat_succeeded"
    ]);
    const failures = events.filter(
      (e): e is Extract<HeartbeatLoopEvent, { type: "heartbeat_failed" }> =>
        e.type === "heartbeat_failed"
    );
    expect(failures[0]?.nextRetryMs).toBe(backoff.baseMs);
    expect(failures[1]?.nextRetryMs).toBe(backoff.baseMs * 2);
  });

  it("never schedules a retry beyond the configured maximum delay", async () => {
    const sendHeartbeat = vi.fn().mockRejectedValue(new Error("always down"));
    const events: HeartbeatLoopEvent[] = [];
    const loop = new HeartbeatLoop({
      buildPayload: async () => payload,
      sendHeartbeat,
      intervalMs: 5000,
      backoff,
      onEvent: (event) => events.push(event)
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(0); // attempt 1 -> fail, next 1000
    await vi.advanceTimersByTimeAsync(1000); // attempt 2 -> fail, next 2000
    await vi.advanceTimersByTimeAsync(2000); // attempt 3 -> fail, next 4000
    await vi.advanceTimersByTimeAsync(4000); // attempt 4 -> fail, next 8000 (capped)
    await vi.advanceTimersByTimeAsync(8000); // attempt 5 -> fail, still capped at 8000

    const delays = events
      .filter(
        (e): e is Extract<HeartbeatLoopEvent, { type: "heartbeat_failed" }> =>
          e.type === "heartbeat_failed"
      )
      .map((e) => e.nextRetryMs);
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it("flags a 401 as authRejected, keeps retrying, and never re-registers or exits", async () => {
    const sendHeartbeat = vi.fn().mockRejectedValue(new UnauthorizedApiError("API rejected worker credentials"));
    const events: HeartbeatLoopEvent[] = [];
    const loop = new HeartbeatLoop({
      buildPayload: async () => payload,
      sendHeartbeat,
      intervalMs: 5000,
      backoff,
      onEvent: (event) => events.push(event)
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(backoff.baseMs);

    const failures = events.filter(
      (e): e is Extract<HeartbeatLoopEvent, { type: "heartbeat_failed" }> => e.type === "heartbeat_failed"
    );
    expect(failures).toHaveLength(2);
    expect(failures.every((f) => f.authRejected)).toBe(true);
    // Still alive and still retrying - the loop's own contract for every
    // failure category, auth included (see heartbeat-loop.ts's own doc
    // comment: "never a reason to exit or re-register").
    expect(sendHeartbeat).toHaveBeenCalledTimes(2);
  });

  it("never flags an ordinary API error (non-401) as authRejected", async () => {
    const sendHeartbeat = vi.fn().mockRejectedValue(new ApiResponseError("server error", 500));
    const events: HeartbeatLoopEvent[] = [];
    const loop = new HeartbeatLoop({
      buildPayload: async () => payload,
      sendHeartbeat,
      intervalMs: 5000,
      backoff,
      onEvent: (event) => events.push(event)
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(0);

    const failure = events.find((e): e is Extract<HeartbeatLoopEvent, { type: "heartbeat_failed" }> => e.type === "heartbeat_failed");
    expect(failure?.authRejected).toBe(false);
  });

  it("stop() prevents any further heartbeats", async () => {
    const sendHeartbeat = vi.fn().mockResolvedValue(workerDto);
    const loop = new HeartbeatLoop({
      buildPayload: async () => payload,
      sendHeartbeat,
      intervalMs: 5000,
      backoff
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendHeartbeat).toHaveBeenCalledTimes(1);

    loop.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("stop() before the first tick fires means no heartbeat is ever sent", async () => {
    const sendHeartbeat = vi.fn().mockResolvedValue(workerDto);
    const loop = new HeartbeatLoop({
      buildPayload: async () => payload,
      sendHeartbeat,
      intervalMs: 5000,
      backoff
    });

    loop.start();
    loop.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendHeartbeat).not.toHaveBeenCalled();
  });

  it("emits a loop_stopped event exactly once per stop() call", () => {
    const events: HeartbeatLoopEvent[] = [];
    const loop = new HeartbeatLoop({
      buildPayload: async () => payload,
      sendHeartbeat: vi.fn().mockResolvedValue(workerDto),
      intervalMs: 5000,
      backoff,
      onEvent: (event) => events.push(event)
    });

    loop.stop();
    expect(events).toEqual([{ type: "loop_stopped" }]);
  });
});
