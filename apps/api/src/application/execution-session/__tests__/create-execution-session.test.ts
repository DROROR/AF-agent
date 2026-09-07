import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { ExecutionPlanNotFoundError, PreconditionNotMetError, ProjectNotFoundError, WorkerNotFoundError, WorkerOfflineError } from "../../../errors/app-error.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { InMemoryExecutionSessionRepository } from "../test-support/in-memory-execution-session-repository.js";
import { createProject } from "../../project/create-project.js";
import { createExecutionSession } from "../create-execution-session.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const STALE_AFTER_MS = 30_000;
const SHA = "a".repeat(64);

function minimalManifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: SHA },
    afterEffects: { version: "26.3x87" },
    generatedAt: FIXED_NOW.toISOString(),
    compositions: [],
    scenes: [],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

async function healthyWorkerWithExecuteFrame(workerRepository: InMemoryWorkerRepository, name: string): Promise<string> {
  const workerId = randomUUID();
  await workerRepository.create({ id: workerId, name, tokenHash: "hash", maxConcurrency: 1, capabilities: ["EXECUTE_FRAME"] }, FIXED_NOW);
  await workerRepository.updateHeartbeat(workerId, { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: null }, FIXED_NOW);
  return workerId;
}

async function approvedPlanFor(executionPlanRepository: InMemoryExecutionPlanRepository, projectId: string) {
  return executionPlanRepository.createRevision(
    {
      id: randomUUID(),
      projectId,
      revision: 1,
      status: "APPROVED",
      templateId: "tmpl-1",
      sourceProjectSha256: SHA,
      scenePlans: [],
      approvedAt: FIXED_NOW,
      approvedBy: "tester"
    },
    FIXED_NOW
  );
}

function deps(
  workerRepository: InMemoryWorkerRepository,
  projectRepository: InMemoryProjectRepository,
  executionPlanRepository: InMemoryExecutionPlanRepository,
  executionSessionRepository: InMemoryExecutionSessionRepository = new InMemoryExecutionSessionRepository()
) {
  return { executionSessionRepository, executionPlanRepository, projectRepository, workerRepository, now: () => FIXED_NOW, staleAfterMs: STALE_AFTER_MS };
}

describe("createExecutionSession - project worker affinity (live QA Blocker 1)", () => {
  it("A: creates the session against the project's own sourceWorkerId even when a second healthy/ONLINE/capable Worker is also registered", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const workerA = await healthyWorkerWithExecuteFrame(workerRepository, "Worker A (inspected this project)");
    await healthyWorkerWithExecuteFrame(workerRepository, "Worker B (unrelated, also healthy)");
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest(), sourceWorkerId: workerA });
    await approvedPlanFor(executionPlanRepository, project.projectId);

    const session = await createExecutionSession(deps(workerRepository, projectRepository, executionPlanRepository), project.projectId, workerA);
    expect(session.assignedWorkerId).toBe(workerA);
  });

  it("B: rejects starting a session against a different, itself perfectly healthy Worker than the project's sourceWorkerId - never silently uses it", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const workerA = await healthyWorkerWithExecuteFrame(workerRepository, "Worker A (inspected this project)");
    const workerB = await healthyWorkerWithExecuteFrame(workerRepository, "Worker B (healthy, but never inspected this project)");
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest(), sourceWorkerId: workerA });
    await approvedPlanFor(executionPlanRepository, project.projectId);

    await expect(createExecutionSession(deps(workerRepository, projectRepository, executionPlanRepository), project.projectId, workerB)).rejects.toThrow(
      PreconditionNotMetError
    );
  });

  it("B: rejects when the project's own sourceWorkerId is currently OFFLINE - fails closed, never substitutes another worker (this test doesn't even register one)", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const workerA = randomUUID();
    await workerRepository.create({ id: workerA, name: "Worker A", tokenHash: "hash", maxConcurrency: 1, capabilities: ["EXECUTE_FRAME"] }, FIXED_NOW);
    // Never heartbeated - status defaults to OFFLINE.
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest(), sourceWorkerId: workerA });
    await approvedPlanFor(executionPlanRepository, project.projectId);

    await expect(createExecutionSession(deps(workerRepository, projectRepository, executionPlanRepository), project.projectId, workerA)).rejects.toThrow(
      WorkerOfflineError
    );
  });

  it("preserves today's unrestricted behavior for a project with no recorded sourceWorkerId (null)", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const workerB = await healthyWorkerWithExecuteFrame(workerRepository, "Worker B");
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest() });
    await approvedPlanFor(executionPlanRepository, project.projectId);

    const session = await createExecutionSession(deps(workerRepository, projectRepository, executionPlanRepository), project.projectId, workerB);
    expect(session.assignedWorkerId).toBe(workerB);
  });

  it("rejects a nonexistent project", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    await expect(createExecutionSession(deps(workerRepository, projectRepository, executionPlanRepository), randomUUID(), randomUUID())).rejects.toThrow(
      ProjectNotFoundError
    );
  });

  it("rejects when no approved execution plan exists yet", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const workerA = await healthyWorkerWithExecuteFrame(workerRepository, "Worker A");
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest(), sourceWorkerId: workerA });

    await expect(createExecutionSession(deps(workerRepository, projectRepository, executionPlanRepository), project.projectId, workerA)).rejects.toThrow(
      ExecutionPlanNotFoundError
    );
  });

  it("rejects a nonexistent requested worker", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest() });
    await approvedPlanFor(executionPlanRepository, project.projectId);

    await expect(createExecutionSession(deps(workerRepository, projectRepository, executionPlanRepository), project.projectId, randomUUID())).rejects.toThrow(
      WorkerNotFoundError
    );
  });
});
