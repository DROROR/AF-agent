import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { createJob } from "../create-job.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

describe("createJob", () => {
  it("creates a QUEUED job with a validated payload", async () => {
    const jobRepository = new InMemoryJobRepository();
    const job = await createJob(
      { jobRepository, now: () => FIXED_NOW },
      {
        workerId: randomUUID(),
        operation: "INSPECT_TEMPLATE",
        payload: { templateId: "tmpl-1", sourceProjectPath: "/copies/test.aep" }
      }
    );
    expect(job.status).toBe("QUEUED");
    expect(job.payload).toEqual({ templateId: "tmpl-1", sourceProjectPath: "/copies/test.aep" });
  });

  it("rejects a payload that does not match the operation's schema", async () => {
    const jobRepository = new InMemoryJobRepository();
    await expect(
      createJob(
        { jobRepository, now: () => FIXED_NOW },
        { workerId: randomUUID(), operation: "INSPECT_TEMPLATE", payload: { wrong: "shape" } }
      )
    ).rejects.toThrow();
  });

  it("rejects an operation with no registered payload schema, rather than accepting an arbitrary payload for it", async () => {
    const jobRepository = new InMemoryJobRepository();
    await expect(
      createJob(
        { jobRepository, now: () => FIXED_NOW },
        { workerId: randomUUID(), operation: "RENDER", payload: { anything: true } }
      )
    ).rejects.toThrow();
  });

  it("persists createdByUserId when the caller supplies one", async () => {
    const jobRepository = new InMemoryJobRepository();
    const userId = randomUUID();
    const job = await createJob(
      { jobRepository, now: () => FIXED_NOW },
      {
        workerId: randomUUID(),
        createdByUserId: userId,
        operation: "INSPECT_TEMPLATE",
        payload: { templateId: "tmpl-1", sourceProjectPath: "/copies/test.aep" }
      }
    );
    expect(job.createdByUserId).toBe(userId);
  });

  it("defaults createdByUserId to null when the caller supplies none", async () => {
    const jobRepository = new InMemoryJobRepository();
    const job = await createJob(
      { jobRepository, now: () => FIXED_NOW },
      { workerId: randomUUID(), operation: "INSPECT_TEMPLATE", payload: { templateId: "tmpl-1", sourceProjectPath: "/copies/test.aep" } }
    );
    expect(job.createdByUserId).toBeNull();
  });
});
