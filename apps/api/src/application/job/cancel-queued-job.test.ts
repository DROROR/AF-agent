import { describe, expect, it } from "vitest";
import { InMemoryJobRepository } from "./test-support/in-memory-job-repository.js";
import { cancelQueuedJob } from "./cancel-queued-job.js";
import { JobNotFoundError, PreconditionNotMetError } from "../../errors/app-error.js";

const userId = "db5be8b5-86d0-435b-acb8-05d101852499";
const otherUserId = "11111111-1111-1111-1111-111111111111";
const workerId = "accd0a71-dbd6-4a53-8b81-d3fe4609420b";
const now = () => new Date("2026-09-12T14:35:00.000Z");

async function seed(repository: InMemoryJobRepository, overrides: Record<string, unknown> = {}) {
  return repository.create({
    id: "df76c2be-3cfc-4ccd-8048-8203efbbe44c",
    workerId,
    projectId: null,
    createdByUserId: userId,
    operation: "INSPECT_TEMPLATE",
    payload: { templateId: "mixkit-smartphone-promo-596", sourceProjectPath: "C:\\DYO-Agent\\x.aep" },
    ...overrides
  } as never, new Date("2026-09-12T14:19:38.162Z"));
}

describe("cancelQueuedJob", () => {
  it("cancels a QUEUED job that was never claimed - the real df76c2be case", async () => {
    const repository = new InMemoryJobRepository();
    const job = await seed(repository);

    const dto = await cancelQueuedJob({ jobRepository: repository, now }, userId, job.id);

    expect(dto.status).toBe("CANCELLED");
    expect((await repository.findById(job.id))?.status).toBe("CANCELLED");
  });

  it("UNBLOCKS a later dispatch of the same operation, which a non-terminal job otherwise prevents", async () => {
    const repository = new InMemoryJobRepository();
    const job = await seed(repository);
    expect(await repository.hasNonTerminalJobForOperation(workerId, "INSPECT_TEMPLATE")).toBe(true);

    await cancelQueuedJob({ jobRepository: repository, now }, userId, job.id);

    expect(await repository.hasNonTerminalJobForOperation(workerId, "INSPECT_TEMPLATE")).toBe(false);
  });

  it("records a structured reason, never a bare status flip", async () => {
    const repository = new InMemoryJobRepository();
    const job = await seed(repository);
    await cancelQueuedJob({ jobRepository: repository, now }, userId, job.id);
    expect((await repository.findById(job.id))?.error?.message).toMatch(/never claimed/);
  });

  it("refuses a job owned by a different user as NOT FOUND, never as forbidden", async () => {
    const repository = new InMemoryJobRepository();
    const job = await seed(repository);
    await expect(cancelQueuedJob({ jobRepository: repository, now }, otherUserId, job.id)).rejects.toBeInstanceOf(
      JobNotFoundError
    );
    expect((await repository.findById(job.id))?.status).toBe("QUEUED");
  });

  it("refuses an unknown job id", async () => {
    const repository = new InMemoryJobRepository();
    await expect(
      cancelQueuedJob({ jobRepository: repository, now }, userId, "00000000-0000-0000-0000-000000000000")
    ).rejects.toBeInstanceOf(JobNotFoundError);
  });

  it("REFUSES to cancel a job a worker has already claimed - the DB must never contradict the machine", async () => {
    const repository = new InMemoryJobRepository();
    const job = await seed(repository);
    await repository.claimNextForWorker(workerId, 1, new Date("2026-09-12T14:30:00.000Z"));

    await expect(cancelQueuedJob({ jobRepository: repository, now }, userId, job.id)).rejects.toBeInstanceOf(
      PreconditionNotMetError
    );
  });
});
