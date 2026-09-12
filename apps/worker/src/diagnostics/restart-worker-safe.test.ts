import { describe, expect, it, vi } from "vitest";
import {
  restartWorkerSafe,
  RESTART_GRACE_MS,
  type ActiveWorkSnapshot,
  type RestartWorkerSafeDeps
} from "./restart-worker-safe.js";

const workerId = "accd0a71-dbd6-4a53-8b81-d3fe4609420b";
const request = { confirm: "RESTART_DYO_WORKER_SAFE", reason: "diagnosing a silent worker" } as const;

function makeDeps(active: ActiveWorkSnapshot, scheduleExit = vi.fn()): RestartWorkerSafeDeps {
  return {
    workerId,
    now: () => new Date("2026-09-12T14:30:00.000Z"),
    describeActiveWork: () => active,
    scheduleExit,
    logger: { info: vi.fn(), warn: vi.fn() }
  };
}

const idle: ActiveWorkSnapshot = { jobId: null, operation: null, mutating: false, checkpointed: false };

describe("restartWorkerSafe", () => {
  it("restarts when the worker is idle", () => {
    const scheduleExit = vi.fn();
    const response = restartWorkerSafe(makeDeps(idle, scheduleExit), request);

    expect(response.outcome).toBe("restarting");
    expect(response.refusalReason).toBeNull();
    expect(scheduleExit).toHaveBeenCalledWith(RESTART_GRACE_MS, 0);
  });

  it("does not exit SYNCHRONOUSLY, so this job's own result can reach the API first", () => {
    const scheduleExit = vi.fn();
    restartWorkerSafe(makeDeps(idle, scheduleExit), request);
    const [delay] = scheduleExit.mock.calls[0] as [number, number];
    expect(delay).toBeGreaterThan(0);
  });

  it("REFUSES while an uncheckpointed mutating job is in flight, and changes nothing", () => {
    const scheduleExit = vi.fn();
    const response = restartWorkerSafe(
      makeDeps({ jobId: "48bf41d3-153d-472a-af2f-207ded38bbad", operation: "RENDER", mutating: true, checkpointed: false }, scheduleExit),
      request
    );

    expect(response.outcome).toBe("refused");
    expect(response.refusalReason).toBe("UNSAFE_JOB_IN_FLIGHT");
    expect(response.detail).toContain("Nothing was changed");
    expect(scheduleExit).not.toHaveBeenCalled();
  });

  it("allows a restart when the in-flight mutating job HAS a durable checkpoint", () => {
    const scheduleExit = vi.fn();
    const response = restartWorkerSafe(
      makeDeps({ jobId: "j", operation: "EXECUTE_FRAME", mutating: true, checkpointed: true }, scheduleExit),
      request
    );
    expect(response.outcome).toBe("restarting");
    expect(scheduleExit).toHaveBeenCalled();
  });

  it("allows a restart during a READ-ONLY job - an inspection is safe to interrupt", () => {
    const scheduleExit = vi.fn();
    const response = restartWorkerSafe(
      makeDeps({ jobId: "j", operation: "INSPECT_TEMPLATE", mutating: false, checkpointed: false }, scheduleExit),
      request
    );
    expect(response.outcome).toBe("restarting");
  });

  it("reports identity as preserved on BOTH paths - this code never touches credentials", () => {
    expect(restartWorkerSafe(makeDeps(idle), request).identityPreserved).toBe(true);
    expect(
      restartWorkerSafe(makeDeps({ jobId: "j", operation: "RENDER", mutating: true, checkpointed: false }), request)
        .identityPreserved
    ).toBe(true);
  });

  it("never spawns anything - the supervisor owns starting the replacement", () => {
    // Guard against a future "helpful" change that starts a new process here
    // and silently creates the duplicate tree this whole design avoids.
    const source = restartWorkerSafe.toString();
    expect(source).not.toContain("spawn");
    expect(source).not.toContain("exec");
  });
});
