import { describe, expect, it, vi } from "vitest";
import type { JobDto } from "@dyo/schemas";
import { reconcileAbandonedJobs } from "./reconcile-abandoned-jobs.js";

function fakeJob(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "c19a2fb9-c385-4254-97ee-2930ff25f917",
    workerId: "345ee0a4-ef4d-4b87-a923-726f97144aa4",
    projectId: null,
    operation: "INSPECT_SCENE_EVIDENCE",
    status: "RUNNING",
    payload: {},
    result: null,
    error: null,
    checkpoint: null,
    createdAt: new Date().toISOString(),
    claimedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("reconcileAbandonedJobs", () => {
  it("P5 test 6/12: reconciles a pre-existing abandoned RUNNING job to FAILED/ABANDONED_RECONCILED on a fresh worker process's startup", async () => {
    const reportJobStatus = vi.fn(async () => ({}));
    const job = fakeJob();

    await reconcileAbandonedJobs({
      listActiveJobs: async () => [job],
      reportJobStatus
    });

    expect(reportJobStatus).toHaveBeenCalledWith(job.jobId, {
      status: "FAILED",
      error: { code: "ABANDONED_RECONCILED", message: expect.any(String) }
    });
  });

  it("does nothing (no report calls) when there is nothing active - the normal case on every ordinary restart", async () => {
    const reportJobStatus = vi.fn();
    await reconcileAbandonedJobs({ listActiveJobs: async () => [], reportJobStatus });
    expect(reportJobStatus).not.toHaveBeenCalled();
  });

  it("reconciles every abandoned job found, not just the first", async () => {
    const reportJobStatus = vi.fn(async () => ({}));
    const jobA = fakeJob({ jobId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    const jobB = fakeJob({ jobId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });

    await reconcileAbandonedJobs({ listActiveJobs: async () => [jobA, jobB], reportJobStatus });

    expect(reportJobStatus).toHaveBeenCalledTimes(2);
  });

  it("never throws if listing fails - logs and returns, tried again naturally on the next opportunity", async () => {
    const warn = vi.fn();
    await expect(
      reconcileAbandonedJobs({
        listActiveJobs: async () => {
          throw new Error("network blip");
        },
        reportJobStatus: vi.fn(),
        logger: { info: vi.fn(), warn }
      })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("never throws if one job's reconciliation report fails - continues to the next and leaves the failed one non-terminal rather than crashing startup", async () => {
    const jobA = fakeJob({ jobId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    const jobB = fakeJob({ jobId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
    const reportJobStatus = vi.fn(async (jobId: string) => {
      if (jobId === jobA.jobId) {
        throw new Error("conflict");
      }
      return {};
    });

    await expect(
      reconcileAbandonedJobs({ listActiveJobs: async () => [jobA, jobB], reportJobStatus })
    ).resolves.toBeUndefined();

    expect(reportJobStatus).toHaveBeenCalledTimes(2);
  });
});
