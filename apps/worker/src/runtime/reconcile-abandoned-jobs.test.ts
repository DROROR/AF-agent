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

// Never real timers - every test that exercises a retry path injects this
// so the suite stays fast (production uses real 1s/2s/4s/5s backoff).
const FAST_RETRY = { maxAttempts: 3, policy: { baseMs: 1, maxMs: 1 } };
const NO_DELAY = (): Promise<void> => Promise.resolve();

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

  it("never throws if listing fails after exhausting retries - logs and returns", async () => {
    const warn = vi.fn();
    await expect(
      reconcileAbandonedJobs({
        listActiveJobs: async () => {
          throw new Error("network blip");
        },
        reportJobStatus: vi.fn(),
        logger: { info: vi.fn(), warn },
        retryOptions: FAST_RETRY,
        sleep: NO_DELAY
      })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("never throws if one job's reconciliation report fails after exhausting retries - continues to the next and leaves the failed one non-terminal rather than crashing startup", async () => {
    const jobA = fakeJob({ jobId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    const jobB = fakeJob({ jobId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
    const reportJobStatus = vi.fn(async (jobId: string) => {
      if (jobId === jobA.jobId) {
        throw new Error("conflict");
      }
      return {};
    });

    await expect(
      reconcileAbandonedJobs({
        listActiveJobs: async () => [jobA, jobB],
        reportJobStatus,
        retryOptions: FAST_RETRY,
        sleep: NO_DELAY
      })
    ).resolves.toBeUndefined();

    // jobA: 3 attempts (FAST_RETRY.maxAttempts), then gives up. jobB: 1 successful attempt.
    expect(reportJobStatus).toHaveBeenCalledTimes(4);
  });

  describe("ROOT CAUSE fix (2026-09-04): bounded retry, never a single unretried attempt", () => {
    it("retries listActiveJobs on a transient failure and succeeds once it stops failing", async () => {
      let attempts = 0;
      const job = fakeJob();
      const reportJobStatus = vi.fn(async () => ({}));

      await reconcileAbandonedJobs({
        listActiveJobs: async () => {
          attempts += 1;
          if (attempts < 3) {
            throw new Error("transient");
          }
          return [job];
        },
        reportJobStatus,
        retryOptions: FAST_RETRY,
        sleep: NO_DELAY
      });

      expect(attempts).toBe(3);
      expect(reportJobStatus).toHaveBeenCalledTimes(1);
    });

    it("retries reportJobStatus for one job on a transient failure and succeeds once it stops failing", async () => {
      const job = fakeJob();
      let attempts = 0;

      await reconcileAbandonedJobs({
        listActiveJobs: async () => [job],
        reportJobStatus: async () => {
          attempts += 1;
          if (attempts < 2) {
            throw new Error("transient");
          }
          return {};
        },
        retryOptions: FAST_RETRY,
        sleep: NO_DELAY
      });

      expect(attempts).toBe(2);
    });

    it("never exceeds the configured maxAttempts, even under permanent failure", async () => {
      let attempts = 0;
      await reconcileAbandonedJobs({
        listActiveJobs: async () => {
          attempts += 1;
          throw new Error("permanent");
        },
        reportJobStatus: vi.fn(),
        retryOptions: { maxAttempts: 2, policy: { baseMs: 1, maxMs: 1 } },
        sleep: NO_DELAY
      });
      expect(attempts).toBe(2);
    });

    it("waits between attempts using the injected sleep, bounded by the policy - never a tight loop", async () => {
      const delays: number[] = [];
      let attempts = 0;
      await reconcileAbandonedJobs({
        listActiveJobs: async () => {
          attempts += 1;
          throw new Error("permanent");
        },
        reportJobStatus: vi.fn(),
        retryOptions: { maxAttempts: 3, policy: { baseMs: 10, maxMs: 100 } },
        sleep: async (ms) => {
          delays.push(ms);
        }
      });
      expect(attempts).toBe(3);
      expect(delays).toEqual([10, 20]); // one sleep between each of the 3 attempts, never after the last
    });
  });
});
