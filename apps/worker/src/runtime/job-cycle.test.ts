import { describe, expect, it, vi } from "vitest";
import type { JobDto } from "@dyo/schemas";
import { runJobCycle } from "./job-cycle.js";

function baseJob(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "11111111-1111-1111-1111-111111111111",
    workerId: "22222222-2222-2222-2222-222222222222",
    operation: "INSPECT_TEMPLATE",
    status: "CLAIMED",
    payload: {},
    result: null,
    error: null,
    checkpoint: null,
    createdAt: new Date().toISOString(),
    claimedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("runJobCycle", () => {
  it("emits no_job_available and does nothing else when there is nothing to claim", async () => {
    const events: unknown[] = [];
    const executeJob = vi.fn();
    const reportJobStatus = vi.fn();
    await runJobCycle({
      claimNextJob: async () => ({ job: null }),
      reportJobStatus,
      executeJob,
      onEvent: (e) => events.push(e)
    });
    expect(events).toEqual([{ type: "no_job_available" }]);
    expect(executeJob).not.toHaveBeenCalled();
    expect(reportJobStatus).not.toHaveBeenCalled();
  });

  it("claims, reports RUNNING, executes, and reports the final SUCCEEDED status", async () => {
    const job = baseJob();
    const events: unknown[] = [];
    const reportCalls: unknown[] = [];
    await runJobCycle({
      claimNextJob: async () => ({ job }),
      reportJobStatus: async (jobId, body) => {
        reportCalls.push({ jobId, body });
        return { ...job, status: body.status };
      },
      executeJob: async () => ({ status: "SUCCEEDED", result: { ok: true } }),
      onEvent: (e) => events.push(e)
    });

    expect(reportCalls).toEqual([
      { jobId: job.jobId, body: { status: "RUNNING" } },
      { jobId: job.jobId, body: { status: "SUCCEEDED", result: { ok: true } } }
    ]);
    expect(events).toEqual([
      { type: "job_claimed", jobId: job.jobId, operation: job.operation },
      { type: "job_completed", jobId: job.jobId, status: "SUCCEEDED" }
    ]);
  });

  it("reports FAILED with the dispatcher's typed error when execution fails", async () => {
    const job = baseJob();
    const reportCalls: unknown[] = [];
    await runJobCycle({
      claimNextJob: async () => ({ job }),
      reportJobStatus: async (jobId, body) => {
        reportCalls.push(body);
        return { ...job, status: body.status };
      },
      executeJob: async () => ({ status: "FAILED", error: { code: "NOT_AVAILABLE", message: "no bridge yet" } })
    });

    expect(reportCalls).toEqual([
      { status: "RUNNING" },
      { status: "FAILED", error: { code: "NOT_AVAILABLE", message: "no bridge yet" } }
    ]);
  });

  it("never throws when claiming fails - reports job_cycle_failed instead", async () => {
    const events: unknown[] = [];
    await expect(
      runJobCycle({
        claimNextJob: async () => {
          throw new Error("network down");
        },
        reportJobStatus: vi.fn(),
        executeJob: vi.fn(),
        onEvent: (e) => events.push(e)
      })
    ).resolves.toBeUndefined();
    expect(events).toEqual([{ type: "job_cycle_failed", error: expect.any(Error) }]);
  });

  it("never throws and never executes the job when reporting RUNNING fails", async () => {
    const job = baseJob();
    const executeJob = vi.fn();
    const events: unknown[] = [];
    await runJobCycle({
      claimNextJob: async () => ({ job }),
      reportJobStatus: async () => {
        throw new Error("api down");
      },
      executeJob,
      onEvent: (e) => events.push(e)
    });
    expect(executeJob).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "job_cycle_failed", error: expect.any(Error) });
  });
});
