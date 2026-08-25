import { describe, expect, it } from "vitest";
import type { WorkerDto } from "@dyo/schemas";
import { computeOverviewMetrics } from "./overview-metrics";

function worker(overrides: Partial<WorkerDto> = {}): WorkerDto {
  return {
    workerId: "11111111-1111-1111-1111-111111111111",
    name: "worker-a",
    status: "OFFLINE",
    lastHeartbeatAt: null,
    aeStatus: "UNKNOWN",
    mcpStatus: "UNKNOWN",
    aeVersion: null,
    capabilities: [],
    maxConcurrency: 1,
    currentJobId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("computeOverviewMetrics", () => {
  it("counts online/AE-online/MCP-online independently across workers", () => {
    const metrics = computeOverviewMetrics([
      worker({ workerId: "1", status: "ONLINE", aeStatus: "ONLINE", mcpStatus: "OFFLINE" }),
      worker({ workerId: "2", status: "ONLINE", aeStatus: "OFFLINE", mcpStatus: "ONLINE" }),
      worker({ workerId: "3", status: "OFFLINE", aeStatus: "UNKNOWN", mcpStatus: "UNKNOWN" })
    ]);
    expect(metrics.workersOnline).toBe(2);
    expect(metrics.workersTotal).toBe(3);
    expect(metrics.aeOnline).toBe(1);
    expect(metrics.mcpOnline).toBe(1);
  });

  it("returns zeroed metrics and no heartbeat for an empty worker list, never fabricating a value", () => {
    const metrics = computeOverviewMetrics([]);
    expect(metrics).toEqual({
      workersOnline: 0,
      workersTotal: 0,
      aeOnline: 0,
      mcpOnline: 0,
      activeJobs: [],
      mostRecentHeartbeatAt: null
    });
  });

  it("collects only workers with a non-null currentJobId as active jobs", () => {
    const metrics = computeOverviewMetrics([
      worker({ workerId: "1", name: "worker-a", currentJobId: "job-1" }),
      worker({ workerId: "2", name: "worker-b", currentJobId: null })
    ]);
    expect(metrics.activeJobs).toEqual([{ workerId: "1", workerName: "worker-a", jobId: "job-1" }]);
  });

  it("finds the single most recent heartbeat across all workers, ignoring workers with no heartbeat yet", () => {
    const metrics = computeOverviewMetrics([
      worker({ workerId: "1", lastHeartbeatAt: "2026-08-24T10:00:00.000Z" }),
      worker({ workerId: "2", lastHeartbeatAt: "2026-08-25T10:00:00.000Z" }),
      worker({ workerId: "3", lastHeartbeatAt: null })
    ]);
    expect(metrics.mostRecentHeartbeatAt).toBe("2026-08-25T10:00:00.000Z");
  });
});
