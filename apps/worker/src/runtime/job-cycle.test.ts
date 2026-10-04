import { describe, expect, it, vi } from "vitest";
import type { JobDto } from "@dyo/schemas";
import { runJobCycle } from "./job-cycle.js";

function baseJob(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "11111111-1111-1111-1111-111111111111",
    workerId: "22222222-2222-2222-2222-222222222222",
    projectId: null,
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

  it("never throws when job execution itself throws - reports job_cycle_failed instead of crashing the caller", async () => {
    // Regression: this call was previously unguarded. Since index.ts
    // invokes runJobCycle as `void runJobCycle(...)` with no .catch(), an
    // exception escaping here became an unhandled promise rejection -
    // which crashes the entire worker process under Node's default
    // behavior, not just this one job.
    const job = baseJob();
    const events: unknown[] = [];
    await expect(
      runJobCycle({
        claimNextJob: async () => ({ job }),
        reportJobStatus: async () => ({ ...job, status: "RUNNING" }),
        executeJob: async () => {
          throw new Error("template inspector crashed");
        },
        onEvent: (e) => events.push(e)
      })
    ).resolves.toBeUndefined();
    expect(events).toEqual([
      { type: "job_claimed", jobId: job.jobId, operation: job.operation },
      { type: "job_cycle_failed", error: expect.any(Error) }
    ]);
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
      onEvent: (e) => events.push(e),
      sleep: async () => {}
    });
    expect(executeJob).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "job_cycle_failed", error: expect.any(Error) });
  });

  /**
   * REAL 2026-10-04 INCIDENT: the network dropped for twenty seconds, the one
   * attempt to report a claimed job RUNNING failed, and the job stayed
   * CLAIMED until a person failed it by hand.
   */
  describe("a status report that does not get through is sent again", () => {
    it("RUNNING fails twice, then lands: the job runs and its result is reported", async () => {
      const reports: string[] = [];
      const delays: number[] = [];
      let failuresLeft = 2;
      const events: { type: string }[] = [];
      await runJobCycle({
        claimNextJob: async () => ({ job: baseJob() }),
        reportJobStatus: async (_jobId, body) => {
          if (body.status === "RUNNING" && failuresLeft > 0) {
            failuresLeft -= 1;
            throw new Error("Failed to reach the API");
          }
          reports.push(body.status);
          return baseJob();
        },
        executeJob: async () => ({ status: "SUCCEEDED", result: { ok: true } }) as never,
        onEvent: (e) => events.push(e),
        sleep: async (ms) => {
          delays.push(ms);
        }
      });
      expect(reports).toEqual(["RUNNING", "SUCCEEDED"]);
      expect(delays).toEqual([2_000, 4_000]);
      expect(events.at(-1)?.type).toBe("job_completed");
    });

    it("a finished job's result is sent again too - the work is not lost to one failed request", async () => {
      const reports: string[] = [];
      let finalFailuresLeft = 3;
      await runJobCycle({
        claimNextJob: async () => ({ job: baseJob() }),
        reportJobStatus: async (_jobId, body) => {
          if (body.status !== "RUNNING" && finalFailuresLeft > 0) {
            finalFailuresLeft -= 1;
            throw new Error("Failed to reach the API");
          }
          reports.push(body.status);
          return baseJob();
        },
        executeJob: async () => ({ status: "SUCCEEDED", result: { ok: true } }) as never,
        sleep: async () => {}
      });
      expect(reports).toEqual(["RUNNING", "SUCCEEDED"]);
    });

    it("gives up after its bounded attempts and says so - never an endless loop", async () => {
      let attempts = 0;
      const events: { type: string }[] = [];
      await runJobCycle({
        claimNextJob: async () => ({ job: baseJob() }),
        reportJobStatus: async () => {
          attempts += 1;
          throw new Error("Failed to reach the API");
        },
        executeJob: vi.fn(),
        onEvent: (e) => events.push(e),
        reportRetry: { maxAttempts: 4, policy: { baseMs: 1, maxMs: 2 } },
        sleep: async () => {}
      });
      expect(attempts).toBe(4);
      expect(events.at(-1)?.type).toBe("job_cycle_failed");
    });
  });
});
