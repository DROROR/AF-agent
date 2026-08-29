import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { createProject } from "../../project/create-project.js";
import { listJobsForUser } from "../list-jobs-for-user.js";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";

const NOW = new Date("2026-08-29T00:00:00.000Z");
const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";

function manifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW.toISOString(),
    compositions: [],
    scenes: [],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

describe("listJobsForUser", () => {
  it("returns only the calling user's own jobs, newest first, with worker/project names resolved", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const projectRepository = new InMemoryProjectRepository();
    const workerId = randomUUID();
    await workerRepository.create({ id: workerId, name: "Worker One", tokenHash: "hash", maxConcurrency: 1, capabilities: [] }, NOW);
    const project = await createProject({ projectRepository, now: () => NOW }, { name: "My Project", manifest: manifest() });

    await jobRepository.create(
      { id: randomUUID(), workerId, projectId: project.projectId, createdByUserId: USER_ID, operation: "EXECUTE_FRAME", payload: { executionSessionId: "session-1" } },
      new Date("2026-08-29T00:00:00.000Z")
    );
    await jobRepository.create(
      { id: randomUUID(), workerId, projectId: null, createdByUserId: USER_ID, operation: "CHECK_HEALTH", payload: {} },
      new Date("2026-08-29T00:01:00.000Z")
    );
    // A different user's own job - must never appear.
    await jobRepository.create(
      { id: randomUUID(), workerId, projectId: project.projectId, createdByUserId: OTHER_USER_ID, operation: "CHECK_HEALTH", payload: {} },
      new Date("2026-08-29T00:02:00.000Z")
    );

    const result = await listJobsForUser({ jobRepository, workerRepository, projectRepository }, USER_ID);

    expect(result.jobs).toHaveLength(2);
    // Newest first.
    expect(result.jobs[0]?.operation).toBe("CHECK_HEALTH");
    expect(result.jobs[0]?.projectId).toBeNull();
    expect(result.jobs[0]?.projectName).toBeNull();
    expect(result.jobs[0]?.workerName).toBe("Worker One");
    expect(result.jobs[1]?.operation).toBe("EXECUTE_FRAME");
    expect(result.jobs[1]?.projectName).toBe("My Project");
    expect(result.jobs[1]?.executionSessionId).toBe("session-1");
  });

  it("surfaces a job's typed, already-sanitized error - no DB access needed to see what happened", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const projectRepository = new InMemoryProjectRepository();
    const workerId = randomUUID();
    await workerRepository.create({ id: workerId, name: "Worker One", tokenHash: "hash", maxConcurrency: 1, capabilities: [] }, NOW);
    const job = await jobRepository.create(
      { id: randomUUID(), workerId, projectId: null, createdByUserId: USER_ID, operation: "CHECK_HEALTH", payload: {} },
      NOW
    );
    await jobRepository.updateStatus(
      job.id,
      workerId,
      { expectedCurrentStatus: "QUEUED", status: "FAILED", error: { code: "TRANSPORT_ERROR", message: "AE_UNRESPONSIVE (BRIDGE_TIMEOUT)" } },
      NOW
    );

    const result = await listJobsForUser({ jobRepository, workerRepository, projectRepository }, USER_ID);
    expect(result.jobs[0]?.status).toBe("FAILED");
    expect(result.jobs[0]?.error).toEqual({ code: "TRANSPORT_ERROR", message: "AE_UNRESPONSIVE (BRIDGE_TIMEOUT)" });
  });

  it("returns an empty list for a user who has never dispatched a job", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const projectRepository = new InMemoryProjectRepository();
    const result = await listJobsForUser({ jobRepository, workerRepository, projectRepository }, USER_ID);
    expect(result.jobs).toEqual([]);
  });
});
