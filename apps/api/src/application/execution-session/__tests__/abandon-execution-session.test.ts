import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { ExecutionSessionNotFoundError, PreconditionNotMetError } from "../../../errors/app-error.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { InMemoryExecutionSessionRepository } from "../test-support/in-memory-execution-session-repository.js";
import { createProject } from "../../project/create-project.js";
import { createExecutionSession } from "../create-execution-session.js";
import { abandonExecutionSession } from "../abandon-execution-session.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const LATER_NOW = new Date("2026-01-01T00:05:00.000Z");
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

async function approvedPlanFor(executionPlanRepository: InMemoryExecutionPlanRepository, projectId: string, revision = 1) {
  return executionPlanRepository.createRevision(
    {
      id: randomUUID(),
      projectId,
      revision,
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

/** A full, real setup: an approved plan + a healthy worker + one real, live execution session against it - the exact "session with an unknown durable checkpoint state" shape this whole feature exists to recover from. */
async function setupWithLiveSession() {
  const workerRepository = new InMemoryWorkerRepository();
  const projectRepository = new InMemoryProjectRepository();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const executionSessionRepository = new InMemoryExecutionSessionRepository();
  const workerId = await healthyWorkerWithExecuteFrame(workerRepository, "QA Worker");
  const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest(), sourceWorkerId: workerId });
  const plan = await approvedPlanFor(executionPlanRepository, project.projectId);
  const createDeps = { executionSessionRepository, executionPlanRepository, projectRepository, workerRepository, now: () => FIXED_NOW, staleAfterMs: STALE_AFTER_MS };
  const session = await createExecutionSession(createDeps, project.projectId, workerId);
  return { workerRepository, projectRepository, executionPlanRepository, executionSessionRepository, createDeps, project, plan, workerId, session };
}

describe("abandonExecutionSession - execution-session recovery gap fix (live QA, 2026-09-08)", () => {
  it("marks a PREPARING session FAILED (terminal) - the exact status EXECUTE_FRAME's own working-copy chain-of-custody failure and a rejected preview already use", async () => {
    const { executionSessionRepository, project, session } = await setupWithLiveSession();
    expect(session.status).toBe("PREPARING");

    const abandoned = await abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, project.projectId, session.id);

    expect(abandoned.status).toBe("FAILED");
    expect(abandoned.id).toBe(session.id);
  });

  it("the abandoned row is never deleted - still readable by id afterward for forensic value", async () => {
    const { executionSessionRepository, project, session } = await setupWithLiveSession();
    await abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, project.projectId, session.id);

    const stillThere = await executionSessionRepository.findById(session.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.status).toBe("FAILED");
    expect(stillThere!.id).toBe(session.id);
  });

  it("refuses to abandon a session already FAILED - nothing to abandon", async () => {
    const { executionSessionRepository, project, session } = await setupWithLiveSession();
    await abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, project.projectId, session.id);

    await expect(abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, project.projectId, session.id)).rejects.toThrow(
      PreconditionNotMetError
    );
  });

  it("refuses to abandon a session already COMPLETED - nothing to abandon", async () => {
    const { executionSessionRepository, project, session } = await setupWithLiveSession();
    await executionSessionRepository.markStatus(session.id, "COMPLETED", LATER_NOW);

    await expect(abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, project.projectId, session.id)).rejects.toThrow(
      PreconditionNotMetError
    );
  });

  it("rejects a nonexistent sessionId", async () => {
    const { executionSessionRepository, project } = await setupWithLiveSession();
    await expect(abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, project.projectId, randomUUID())).rejects.toThrow(
      ExecutionSessionNotFoundError
    );
  });

  it("refuses a sessionId that belongs to a DIFFERENT project - never confirms cross-project existence", async () => {
    const { executionSessionRepository, session } = await setupWithLiveSession();
    await expect(abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, randomUUID(), session.id)).rejects.toThrow(
      ExecutionSessionNotFoundError
    );
  });

  it("never touches the execution plan's own revision/status", async () => {
    const { executionSessionRepository, executionPlanRepository, project, session } = await setupWithLiveSession();
    const before = await executionPlanRepository.findCurrentByProjectId(project.projectId);

    await abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, project.projectId, session.id);

    const after = await executionPlanRepository.findCurrentByProjectId(project.projectId);
    expect(after!.revision).toBe(before!.revision);
    expect(after!.status).toBe(before!.status);
    expect(after!.scenePlans).toEqual(before!.scenePlans);
  });

  describe("end-to-end recovery: abandon then create a genuinely fresh session at the SAME plan revision", () => {
    it("create-execution-session reuses the SAME active PREPARING session (regression: normal idempotent behavior is unaffected by this feature existing)", async () => {
      const { createDeps, project, workerId, session } = await setupWithLiveSession();
      const again = await createExecutionSession(createDeps, project.projectId, workerId);
      expect(again.id).toBe(session.id);
    });

    it("after abandoning, create-execution-session creates a genuinely NEW session (different id) rather than reusing the FAILED one", async () => {
      const { executionSessionRepository, createDeps, project, workerId, session } = await setupWithLiveSession();

      await abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, project.projectId, session.id);

      const fresh = await createExecutionSession(createDeps, project.projectId, workerId);
      expect(fresh.id).not.toBe(session.id);
      expect(fresh.status).toBe("PREPARING");
    });

    it("the fresh session is bound to the EXACT SAME plan revision - no plan edit/re-approval was required to get it", async () => {
      const { executionSessionRepository, executionPlanRepository, createDeps, project, workerId, session, plan } = await setupWithLiveSession();

      await abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, project.projectId, session.id);
      const fresh = await createExecutionSession(createDeps, project.projectId, workerId);

      expect(fresh.planRevision).toBe(plan.revision);
      expect(fresh.planRevision).toBe(session.planRevision);
      const currentPlan = await executionPlanRepository.findCurrentByProjectId(project.projectId);
      expect(currentPlan!.revision).toBe(plan.revision);
      expect(currentPlan!.status).toBe("APPROVED");
    });

    it("the fresh session has a genuinely different working-copy identity - its own id, which is the ENTIRE input to the worker's own sessionWorkingCopyPath(workRoot, id), so it can never resolve to the old (partially-mutated) session's own working-copy directory", async () => {
      const { executionSessionRepository, createDeps, project, workerId, session } = await setupWithLiveSession();

      await abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, project.projectId, session.id);
      const fresh = await createExecutionSession(createDeps, project.projectId, workerId);

      // The session id IS the working-copy path's own identity component
      // (apps/worker/src/workspace/working-copy.ts's sessionWorkingCopyPath)
      // - a real, distinct id is sufficient proof the resulting path is
      // distinct too, without this (API-side, filesystem-free) test needing
      // to duplicate the worker's own path-joining logic.
      expect(fresh.id).not.toBe(session.id);
      // A fresh session's own working-copy chain starts completely clean -
      // never inherits the abandoned session's completed scenes or
      // latestWorkingProjectSha256.
      expect(fresh.completedScenePlanIds).toEqual([]);
      expect(fresh.latestWorkingProjectSha256).toBeNull();
    });

    it("the OLD session's own history remains queryable after abandonment - never deleted, still shows its real completedScenePlanIds/status at the time it was abandoned", async () => {
      const { executionSessionRepository, createDeps, project, workerId, session } = await setupWithLiveSession();

      await abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, project.projectId, session.id);
      await createExecutionSession(createDeps, project.projectId, workerId); // the fresh session - old one must still be independently readable afterward

      const oldSession = await executionSessionRepository.findById(session.id);
      expect(oldSession).not.toBeNull();
      expect(oldSession!.status).toBe("FAILED");
      expect(oldSession!.projectId).toBe(project.projectId);
    });

    it("abandoning and creating a fresh session never touches worker state - the client Worker (a second, unrelated worker never assigned to this project) is completely unaffected", async () => {
      const { workerRepository, executionSessionRepository, createDeps, project, workerId, session } = await setupWithLiveSession();
      const clientWorkerId = await healthyWorkerWithExecuteFrame(workerRepository, "Client Worker (unrelated)");
      const clientWorkerBefore = await workerRepository.findById(clientWorkerId);

      await abandonExecutionSession({ executionSessionRepository, now: () => LATER_NOW }, project.projectId, session.id);
      await createExecutionSession(createDeps, project.projectId, workerId);

      const clientWorkerAfter = await workerRepository.findById(clientWorkerId);
      expect(clientWorkerAfter).toEqual(clientWorkerBefore);
    });
  });
});
