import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { createJob } from "../create-job.js";
import { getJobForUser } from "../get-job-for-user.js";
import { JobNotFoundError } from "../../../errors/app-error.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const PAYLOAD = { templateId: "tmpl-1", sourceProjectPath: "/copies/test.aep" };

describe("getJobForUser", () => {
  it("returns the job's real DTO, including its result, when the requesting user is the one who dispatched it", async () => {
    const jobRepository = new InMemoryJobRepository();
    const userId = randomUUID();
    const created = await createJob(
      { jobRepository, now: () => FIXED_NOW },
      { workerId: randomUUID(), createdByUserId: userId, operation: "INSPECT_TEMPLATE", payload: PAYLOAD }
    );

    const dto = await getJobForUser({ jobRepository }, userId, created.id);
    expect(dto.jobId).toBe(created.id);
    expect(dto.status).toBe("QUEUED");
    expect(dto.payload).toEqual(PAYLOAD);
  });

  it("refuses a job dispatched by a DIFFERENT user with the exact same error as a nonexistent job - never confirms it exists", async () => {
    const jobRepository = new InMemoryJobRepository();
    const owner = randomUUID();
    const someoneElse = randomUUID();
    const created = await createJob(
      { jobRepository, now: () => FIXED_NOW },
      { workerId: randomUUID(), createdByUserId: owner, operation: "INSPECT_TEMPLATE", payload: PAYLOAD }
    );

    await expect(getJobForUser({ jobRepository }, someoneElse, created.id)).rejects.toThrow(JobNotFoundError);
  });

  it("refuses a job with no createdByUserId at all (e.g. dispatched before this ownership check existed) for every user, including a null-vs-null coincidence", async () => {
    const jobRepository = new InMemoryJobRepository();
    const created = await createJob(
      { jobRepository, now: () => FIXED_NOW },
      { workerId: randomUUID(), operation: "INSPECT_TEMPLATE", payload: PAYLOAD }
    );

    await expect(getJobForUser({ jobRepository }, randomUUID(), created.id)).rejects.toThrow(JobNotFoundError);
  });

  it("throws JobNotFoundError for a genuinely nonexistent job id", async () => {
    const jobRepository = new InMemoryJobRepository();
    await expect(getJobForUser({ jobRepository }, randomUUID(), randomUUID())).rejects.toThrow(JobNotFoundError);
  });

  it("reflects a real SUCCEEDED status and result once the job completes", async () => {
    const jobRepository = new InMemoryJobRepository();
    const userId = randomUUID();
    const created = await createJob(
      { jobRepository, now: () => FIXED_NOW },
      { workerId: randomUUID(), createdByUserId: userId, operation: "INSPECT_TEMPLATE", payload: PAYLOAD }
    );
    const claimed = await jobRepository.claimNextForWorker(created.workerId, 1, FIXED_NOW);
    await jobRepository.updateStatus(
      created.id,
      created.workerId,
      { expectedCurrentStatus: "CLAIMED", status: "RUNNING" },
      FIXED_NOW
    );
    const result = { manifest: { fake: true }, summary: { compositionCount: 1 } };
    await jobRepository.updateStatus(
      created.id,
      created.workerId,
      { expectedCurrentStatus: "RUNNING", status: "SUCCEEDED", result },
      FIXED_NOW
    );

    const dto = await getJobForUser({ jobRepository }, userId, created.id);
    expect(claimed?.id).toBe(created.id);
    expect(dto.status).toBe("SUCCEEDED");
    expect(dto.result).toEqual(result);
  });

  it("never leaks a FAILED job's error as if it were a successful result", async () => {
    const jobRepository = new InMemoryJobRepository();
    const userId = randomUUID();
    const created = await createJob(
      { jobRepository, now: () => FIXED_NOW },
      { workerId: randomUUID(), createdByUserId: userId, operation: "INSPECT_TEMPLATE", payload: PAYLOAD }
    );
    await jobRepository.claimNextForWorker(created.workerId, 1, FIXED_NOW);
    await jobRepository.updateStatus(
      created.id,
      created.workerId,
      { expectedCurrentStatus: "CLAIMED", status: "FAILED", error: { code: "TRANSPORT_ERROR", message: "bridge unreachable" } },
      FIXED_NOW
    );

    const dto = await getJobForUser({ jobRepository }, userId, created.id);
    expect(dto.status).toBe("FAILED");
    expect(dto.result).toBeNull();
    expect(dto.error).toEqual({ code: "TRANSPORT_ERROR", message: "bridge unreachable" });
  });
});
