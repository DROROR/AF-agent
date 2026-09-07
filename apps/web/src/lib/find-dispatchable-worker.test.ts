import { describe, expect, it } from "vitest";
import type { WorkerDto } from "@dyo/schemas";
import { findDispatchableWorker } from "./find-dispatchable-worker";

function worker(overrides: Partial<WorkerDto> = {}): WorkerDto {
  return {
    workerId: "11111111-1111-1111-1111-111111111111",
    name: "Worker",
    status: "ONLINE",
    lastHeartbeatAt: new Date().toISOString(),
    aeStatus: "ONLINE",
    mcpStatus: "ONLINE",
    aeAvailability: "ONLINE",
    mcpAvailability: "ONLINE",
    aeVersion: "26.0",
    capabilities: ["EXECUTE_FRAME"],
    maxConcurrency: 1,
    currentJobId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("findDispatchableWorker", () => {
  it("returns null when workers is null (status not loaded yet)", () => {
    expect(findDispatchableWorker(null, "EXECUTE_FRAME")).toBeNull();
  });

  it("returns a fully healthy, capable, idle ONLINE worker", () => {
    const w = worker();
    expect(findDispatchableWorker([w], "EXECUTE_FRAME")).toEqual(w);
  });

  it("skips an OFFLINE worker", () => {
    expect(findDispatchableWorker([worker({ status: "OFFLINE" })], "EXECUTE_FRAME")).toBeNull();
  });

  it("skips a busy worker (currentJobId set)", () => {
    expect(findDispatchableWorker([worker({ currentJobId: "job-1" })], "EXECUTE_FRAME")).toBeNull();
  });

  it("skips a worker that does not report the requested capability", () => {
    expect(findDispatchableWorker([worker({ capabilities: ["CHECK_HEALTH"] })], "EXECUTE_FRAME")).toBeNull();
  });

  // Selection precondition consistency (live QA Blocker 1, section 5).
  it("skips a worker whose aeAvailability is not ONLINE for an AE/MCP-dependent capability - dispatch-job.ts would refuse it anyway", () => {
    expect(findDispatchableWorker([worker({ aeAvailability: "UNKNOWN" })], "EXECUTE_FRAME")).toBeNull();
  });

  it("skips a worker whose mcpAvailability is UNKNOWN for an AE/MCP-dependent capability", () => {
    expect(findDispatchableWorker([worker({ mcpAvailability: "UNKNOWN", capabilities: ["INSPECT_SCENE_EVIDENCE"] })], "INSPECT_SCENE_EVIDENCE")).toBeNull();
  });

  it("does NOT apply the AE/MCP availability gate to a non-AE-dependent capability (e.g. CHECK_HEALTH) - never over-restricts", () => {
    const w = worker({ aeAvailability: "UNAVAILABLE", mcpAvailability: "UNAVAILABLE", capabilities: ["CHECK_HEALTH"] });
    expect(findDispatchableWorker([w], "CHECK_HEALTH")).toEqual(w);
  });

  it("picks the first qualifying worker in list order and never a hardcoded id", () => {
    const a = worker({ workerId: "22222222-2222-2222-2222-222222222222" });
    const b = worker({ workerId: "33333333-3333-3333-3333-333333333333" });
    expect(findDispatchableWorker([a, b], "EXECUTE_FRAME")?.workerId).toBe(a.workerId);
  });
});
