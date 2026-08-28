import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import {
  PreconditionNotMetError,
  ProjectNotFoundError,
  WorkerBusyError,
  WorkerNotFoundError,
  WorkerOfflineError
} from "../../../errors/app-error.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { InMemoryExecutionSessionRepository } from "../../execution-session/test-support/in-memory-execution-session-repository.js";
import { InMemoryAssetRepository } from "../../asset/test-support/in-memory-asset-repository.js";
import { createProject } from "../../project/create-project.js";
import { dispatchJob } from "../dispatch-job.js";

function minimalManifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: FIXED_NOW.toISOString(),
    compositions: [],
    scenes: [],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const STALE_AFTER_MS = 30_000;
const PAYLOAD = { templateId: "t", sourceProjectPath: "/copies/t.aep" };

function deps(
  jobRepository: InMemoryJobRepository,
  workerRepository: InMemoryWorkerRepository,
  now = FIXED_NOW,
  projectRepository: InMemoryProjectRepository = new InMemoryProjectRepository(),
  executionPlanRepository: InMemoryExecutionPlanRepository = new InMemoryExecutionPlanRepository(),
  assetRepository: InMemoryAssetRepository = new InMemoryAssetRepository(),
  executionSessionRepository: InMemoryExecutionSessionRepository = new InMemoryExecutionSessionRepository()
) {
  return {
    jobRepository,
    workerRepository,
    projectRepository,
    executionPlanRepository,
    executionSessionRepository,
    assetRepository,
    now: () => now,
    staleAfterMs: STALE_AFTER_MS
  };
}

/** A worker in a fully green state: ONLINE, AE/MCP ONLINE, has the capability, fresh heartbeat, no active job. */
async function setupHealthyWorker(workerRepository: InMemoryWorkerRepository, maxConcurrency = 1) {
  const workerId = randomUUID();
  await workerRepository.create(
    { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency, capabilities: ["INSPECT_TEMPLATE"] },
    FIXED_NOW
  );
  await workerRepository.updateHeartbeat(
    workerId,
    { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: null },
    FIXED_NOW
  );
  return workerId;
}

describe("dispatchJob", () => {
  it("rejects a nonexistent worker", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), {
        operation: "INSPECT_TEMPLATE",
        workerId: randomUUID(),
        payload: PAYLOAD
      })
    ).rejects.toThrow(WorkerNotFoundError);
  });

  it("rejects a worker with a stale heartbeat, even if its DB status still says ONLINE", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupHealthyWorker(workerRepository);

    // Heartbeat happened at FIXED_NOW; "now" for the dispatch call is far past the stale window.
    const staleNow = new Date(FIXED_NOW.getTime() + STALE_AFTER_MS + 1_000);

    await expect(
      dispatchJob(deps(jobRepository, workerRepository, staleNow), {
        operation: "INSPECT_TEMPLATE",
        workerId,
        payload: PAYLOAD
      })
    ).rejects.toThrow(WorkerOfflineError);
  });

  it("rejects when AE is not ONLINE", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["INSPECT_TEMPLATE"] },
      FIXED_NOW
    );
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "OFFLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: null },
      FIXED_NOW
    );

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), { operation: "INSPECT_TEMPLATE", workerId, payload: PAYLOAD })
    ).rejects.toThrow(PreconditionNotMetError);
  });

  it("rejects when MCP is not ONLINE", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["INSPECT_TEMPLATE"] },
      FIXED_NOW
    );
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "ONLINE", mcpStatus: "OFFLINE", aeVersion: "26.0", currentJobId: null },
      FIXED_NOW
    );

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), { operation: "INSPECT_TEMPLATE", workerId, payload: PAYLOAD })
    ).rejects.toThrow(PreconditionNotMetError);
  });

  it("rejects when the worker does not report the INSPECT_TEMPLATE capability", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["CHECK_HEALTH"] },
      FIXED_NOW
    );
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: null },
      FIXED_NOW
    );

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), { operation: "INSPECT_TEMPLATE", workerId, payload: PAYLOAD })
    ).rejects.toThrow(PreconditionNotMetError);
  });

  it("rejects a busy worker (currentJobId already set)", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["INSPECT_TEMPLATE"] },
      FIXED_NOW
    );
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: randomUUID() },
      FIXED_NOW
    );

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), { operation: "INSPECT_TEMPLATE", workerId, payload: PAYLOAD })
    ).rejects.toThrow(WorkerBusyError);
  });

  it("creates exactly one QUEUED job for a fully healthy worker", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupHealthyWorker(workerRepository);

    const result = await dispatchJob(deps(jobRepository, workerRepository), {
      operation: "INSPECT_TEMPLATE",
      workerId,
      payload: PAYLOAD
    });

    expect(result.status).toBe("QUEUED");
    expect(result.workerId).toBe(workerId);
    expect(result.operation).toBe("INSPECT_TEMPLATE");

    const job = await jobRepository.findById(result.jobId);
    expect(job).not.toBeNull();
    expect(job?.status).toBe("QUEUED");
  });

  it("persists the dispatching dashboard user's own id on the created job - the only ownership anchor a not-yet-project-bound job (INSPECT_TEMPLATE) has", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupHealthyWorker(workerRepository);
    const dispatchingUserId = "22222222-2222-2222-2222-222222222222";

    const result = await dispatchJob(
      deps(jobRepository, workerRepository),
      { operation: "INSPECT_TEMPLATE", workerId, payload: PAYLOAD },
      dispatchingUserId
    );

    const job = await jobRepository.findById(result.jobId);
    expect(job?.createdByUserId).toBe(dispatchingUserId);
  });

  it("leaves createdByUserId null when no dispatching user is supplied", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupHealthyWorker(workerRepository);

    const result = await dispatchJob(deps(jobRepository, workerRepository), {
      operation: "INSPECT_TEMPLATE",
      workerId,
      payload: PAYLOAD
    });

    const job = await jobRepository.findById(result.jobId);
    expect(job?.createdByUserId).toBeNull();
  });

  it("rejects a second dispatch while a live INSPECT_TEMPLATE job already exists for this worker (double-submit protection)", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupHealthyWorker(workerRepository);

    await dispatchJob(deps(jobRepository, workerRepository), {
      operation: "INSPECT_TEMPLATE",
      workerId,
      payload: PAYLOAD
    });

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), { operation: "INSPECT_TEMPLATE", workerId, payload: PAYLOAD })
    ).rejects.toThrow(WorkerBusyError);

    const jobs = await jobRepository.countActiveForWorker(workerId);
    // The duplicate was refused before creation - only ever one job row exists for this worker.
    expect(jobs).toBe(0); // still QUEUED, not yet CLAIMED/RUNNING/WAITING_FOR_ACTION
  });

  it("applies the same AE/MCP-ONLINE precondition to INSPECT_SCENE_EVIDENCE as to INSPECT_TEMPLATE", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["INSPECT_SCENE_EVIDENCE"] },
      FIXED_NOW
    );
    // AE deliberately not ONLINE - mirrors the "rejects when the worker does
    // not report AE as ONLINE" scenario already covered for INSPECT_TEMPLATE.
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "OFFLINE", mcpStatus: "ONLINE", aeVersion: null, currentJobId: null },
      FIXED_NOW
    );

    const sceneEvidencePayload = {
      sourceProjectPath: "/copies/t.aep",
      sourceProjectSha256: "a".repeat(64),
      manifestCompositionId: "comp-275",
      aeProjectItemIndex: 14,
      compositionName: "Text 01",
      layerIndices: [1],
      previewTimestampSeconds: null
    };

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), {
        operation: "INSPECT_SCENE_EVIDENCE",
        workerId,
        projectId: randomUUID(),
        payload: sceneEvidencePayload
      })
    ).rejects.toThrow(PreconditionNotMetError);
  });

  it("rejects an INSPECT_SCENE_EVIDENCE dispatch whose projectId does not name a real project - never queued against an unattributable project", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["INSPECT_SCENE_EVIDENCE"] },
      FIXED_NOW
    );
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: null },
      FIXED_NOW
    );

    const sceneEvidencePayload = {
      sourceProjectPath: "/copies/t.aep",
      sourceProjectSha256: "a".repeat(64),
      manifestCompositionId: "comp-275",
      aeProjectItemIndex: 14,
      compositionName: "Text 01",
      layerIndices: [1],
      previewTimestampSeconds: null
    };

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), {
        operation: "INSPECT_SCENE_EVIDENCE",
        workerId,
        projectId: randomUUID(),
        payload: sceneEvidencePayload
      })
    ).rejects.toThrow(ProjectNotFoundError);
  });

  it("attaches the real projectId to the created job when dispatching INSPECT_SCENE_EVIDENCE for a project that exists", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const projectRepository = new InMemoryProjectRepository();
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["INSPECT_SCENE_EVIDENCE"] },
      FIXED_NOW
    );
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: null },
      FIXED_NOW
    );
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest() });

    const sceneEvidencePayload = {
      sourceProjectPath: "/copies/t.aep",
      sourceProjectSha256: "a".repeat(64),
      manifestCompositionId: "comp-275",
      aeProjectItemIndex: 14,
      compositionName: "Text 01",
      layerIndices: [1],
      previewTimestampSeconds: null
    };

    const result = await dispatchJob(
      {
        jobRepository,
        workerRepository,
        projectRepository,
        executionPlanRepository: new InMemoryExecutionPlanRepository(),
        executionSessionRepository: new InMemoryExecutionSessionRepository(),
        assetRepository: new InMemoryAssetRepository(),
        now: () => FIXED_NOW,
        staleAfterMs: STALE_AFTER_MS
      },
      { operation: "INSPECT_SCENE_EVIDENCE", workerId, projectId: project.projectId, payload: sceneEvidencePayload }
    );

    const job = await jobRepository.findById(result.jobId);
    expect(job?.projectId).toBe(project.projectId);
  });
});

function manifestWithTextPlaceholder(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "C:\\vidio agent\\White App Promo (converted).aep", name: "White App Promo (converted).aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: FIXED_NOW.toISOString(),
    compositions: [
      { compositionId: "comp-1", aeProjectItemIndex: 5, name: "Scene 01", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
    ],
    scenes: [
      {
        sceneId: "scene-a",
        displayName: null,
        compositionId: "comp-1",
        originalOrderIndex: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
        placeholders: [
          {
            placeholderId: "ph-1",
            displayLabel: null,
            compositionId: "comp-1",
            layerName: "Headline",
            layerIndex: 2,
            layerPath: [],
            placeholderType: "text",
            editable: true,
            sourceType: "TextLayer",
            dimensions: null,
            startTimeSeconds: 0,
            durationSeconds: 5,
            evidence: { source: "read_directly", reason: "confirmed via ae_get_composition" }
          }
        ]
      }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

function approvedTextScene() {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene 01",
    use: true,
    sourcePosition: 0,
    finalOrder: 0,
    finalDuration: null,
    approvalState: "APPROVED" as const,
    instructions: null,
    notes: null,
    unresolvedReasons: [],
    evidence: [],
    mappings: [
      {
        id: "mapping-1",
        manifestPlaceholderId: "ph-1",
        placeholderName: "Headline",
        placeholderClassification: { value: "text" as const, source: "MANIFEST" as const, evidence: [] },
        selectedAssetId: null,
        selectedAssetType: null,
        text: "Approved Headline",
        assetTimestamp: null,
        colorHex: null,
        layerVisible: null,
        freezeAtSeconds: null,
        layerDurationSeconds: null,
        mappingSource: "HUMAN" as const,
        confidence: null,
        createdAt: FIXED_NOW.toISOString(),
        updatedAt: FIXED_NOW.toISOString()
      }
    ],
    createdAt: FIXED_NOW.toISOString(),
    updatedAt: FIXED_NOW.toISOString()
  };
}

async function setupWorkerWithCapability(workerRepository: InMemoryWorkerRepository, capability: "EXECUTE_FRAME" | "RENDER" | "INSPECT_RENDER_CAPABILITIES") {
  const workerId = randomUUID();
  await workerRepository.create({ id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: [capability] }, FIXED_NOW);
  await workerRepository.updateHeartbeat(workerId, { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.0", currentJobId: null }, FIXED_NOW);
  return workerId;
}

/** A fresh session, pinned to `workerId`, bound to plan-1 revision 1 - no scene completed yet. */
async function createSession(executionSessionRepository: InMemoryExecutionSessionRepository, projectId: string, workerId: string) {
  return executionSessionRepository.create(
    { id: randomUUID(), projectId, executionPlanId: "plan-1", planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: workerId },
    FIXED_NOW
  );
}

/** A session with scene-1 already completed, preview approved, ready to render. */
async function readyToRenderSession(executionSessionRepository: InMemoryExecutionSessionRepository, projectId: string, workerId: string) {
  const session = await createSession(executionSessionRepository, projectId, workerId);
  await executionSessionRepository.recordSceneCompleted(session.id, "scene-1", "d".repeat(64), "AWAITING_PREVIEW_APPROVAL", FIXED_NOW);
  const approved = await executionSessionRepository.approvePreview(session.id, "READY_TO_RENDER", FIXED_NOW);
  if (!approved) throw new Error("test setup: approvePreview returned null");
  return approved;
}

describe("dispatchJob - EXECUTE_FRAME (safe dispatch)", () => {
  it("resolves the full worker payload from trusted state and creates a job carrying it - never the raw request", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const assetRepository = new InMemoryAssetRepository();
    const workerId = await setupWorkerWithCapability(workerRepository, "EXECUTE_FRAME");
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: manifestWithTextPlaceholder() });
    await executionPlanRepository.createRevision(
      {
        id: "plan-1",
        projectId: project.projectId,
        revision: 1,
        status: "APPROVED",
        templateId: "tmpl-1",
        sourceProjectSha256: "a".repeat(64),
        scenePlans: [approvedTextScene()],
        approvedAt: FIXED_NOW,
        approvedBy: "user-1"
      },
      FIXED_NOW
    );
    const session = await createSession(executionSessionRepository, project.projectId, workerId);

    const result = await dispatchJob(
      { jobRepository, workerRepository, projectRepository, executionPlanRepository, executionSessionRepository, assetRepository, now: () => FIXED_NOW, staleAfterMs: STALE_AFTER_MS },
      { operation: "EXECUTE_FRAME", workerId, projectId: project.projectId, executionSessionId: session.id, scenePlanId: "scene-1" }
    );

    const job = await jobRepository.findById(result.jobId);
    expect(job?.projectId).toBe(project.projectId);
    const payload = job?.payload as Record<string, unknown>;
    expect(payload.aeProjectItemIndex).toBe(5);
    expect(payload.compositionName).toBe("Scene 01");
    expect(payload.operations).toEqual([{ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 2, text: "Approved Headline" }]);
    expect(payload.executionSessionId).toBe(session.id);
    expect(payload.expectedWorkingProjectSha256).toBeNull();
    expect(payload.checkpoint).toBeNull();
  });

  it("rejects with PreconditionNotMetError when the resolver itself refuses (e.g. no execution plan exists) - never queues a job anyway", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const projectRepository = new InMemoryProjectRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const workerId = await setupWorkerWithCapability(workerRepository, "EXECUTE_FRAME");
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: manifestWithTextPlaceholder() });
    const session = await createSession(executionSessionRepository, project.projectId, workerId);

    await expect(
      dispatchJob(deps(jobRepository, workerRepository, FIXED_NOW, projectRepository, new InMemoryExecutionPlanRepository(), new InMemoryAssetRepository(), executionSessionRepository), {
        operation: "EXECUTE_FRAME",
        workerId,
        projectId: project.projectId,
        executionSessionId: session.id,
        scenePlanId: "scene-1"
      })
    ).rejects.toThrow(PreconditionNotMetError);

    const active = await jobRepository.countActiveForWorker(workerId);
    expect(active).toBe(0);
  });

  it("rejects when the worker does not report the EXECUTE_FRAME capability", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupWorkerWithCapability(workerRepository, "RENDER");

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), {
        operation: "EXECUTE_FRAME",
        workerId,
        projectId: randomUUID(),
        executionSessionId: randomUUID(),
        scenePlanId: "scene-1"
      })
    ).rejects.toThrow(PreconditionNotMetError);
  });

  it("rejects a second EXECUTE_FRAME dispatch for the same session while its assigned worker already has a job in progress (section 5: concurrency via the existing single-worker-job invariant)", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const assetRepository = new InMemoryAssetRepository();
    const workerId = await setupWorkerWithCapability(workerRepository, "EXECUTE_FRAME");
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: manifestWithTextPlaceholder() });
    await executionPlanRepository.createRevision(
      {
        id: "plan-1",
        projectId: project.projectId,
        revision: 1,
        status: "APPROVED",
        templateId: "tmpl-1",
        sourceProjectSha256: "a".repeat(64),
        scenePlans: [approvedTextScene(), { ...approvedTextScene(), id: "scene-2" }],
        approvedAt: FIXED_NOW,
        approvedBy: "user-1"
      },
      FIXED_NOW
    );
    const session = await createSession(executionSessionRepository, project.projectId, workerId);
    const commonDeps = { jobRepository, workerRepository, projectRepository, executionPlanRepository, executionSessionRepository, assetRepository, now: () => FIXED_NOW, staleAfterMs: STALE_AFTER_MS };

    await dispatchJob(commonDeps, { operation: "EXECUTE_FRAME", workerId, projectId: project.projectId, executionSessionId: session.id, scenePlanId: "scene-1" });

    await expect(
      dispatchJob(commonDeps, { operation: "EXECUTE_FRAME", workerId, projectId: project.projectId, executionSessionId: session.id, scenePlanId: "scene-2" })
    ).rejects.toThrow(WorkerBusyError);
  });

  it("rejects when the dispatched worker is not this session's own assignedWorkerId - worker affinity", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const workerId = await setupWorkerWithCapability(workerRepository, "EXECUTE_FRAME");
    const otherWorkerId = await setupWorkerWithCapability(workerRepository, "EXECUTE_FRAME");
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: manifestWithTextPlaceholder() });
    await executionPlanRepository.createRevision(
      {
        id: "plan-1",
        projectId: project.projectId,
        revision: 1,
        status: "APPROVED",
        templateId: "tmpl-1",
        sourceProjectSha256: "a".repeat(64),
        scenePlans: [approvedTextScene()],
        approvedAt: FIXED_NOW,
        approvedBy: "user-1"
      },
      FIXED_NOW
    );
    // Session pinned to otherWorkerId - this dispatch names workerId instead.
    const session = await createSession(executionSessionRepository, project.projectId, otherWorkerId);

    await expect(
      dispatchJob(
        { jobRepository, workerRepository, projectRepository, executionPlanRepository, executionSessionRepository, assetRepository: new InMemoryAssetRepository(), now: () => FIXED_NOW, staleAfterMs: STALE_AFTER_MS },
        { operation: "EXECUTE_FRAME", workerId, projectId: project.projectId, executionSessionId: session.id, scenePlanId: "scene-1" }
      )
    ).rejects.toThrow(PreconditionNotMetError);
  });
});

describe("dispatchJob - RENDER (safe dispatch)", () => {
  it("resolves the full worker payload from the persisted RenderOutputConfig + the session's own working-copy identity, and creates a job carrying it", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const assetRepository = new InMemoryAssetRepository();
    const workerId = await setupWorkerWithCapability(workerRepository, "RENDER");
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: manifestWithTextPlaceholder() });
    const plan = await executionPlanRepository.createRevision(
      {
        id: "plan-1",
        projectId: project.projectId,
        revision: 1,
        status: "APPROVED",
        templateId: "tmpl-1",
        sourceProjectSha256: "a".repeat(64),
        scenePlans: [approvedTextScene()],
        approvedAt: FIXED_NOW,
        approvedBy: "user-1"
      },
      FIXED_NOW
    );
    await executionPlanRepository.updateRenderOutput(
      plan.id,
      "LANDSCAPE",
      {
        manifestCompositionId: "comp-1",
        aeProjectItemIndex: 5,
        compositionName: "Scene 01",
        sourceProjectSha256: "a".repeat(64),
        renderSettingsTemplateName: "Best Settings",
        outputModuleTemplateName: "H.264 - Match Source",
        configuredAt: FIXED_NOW.toISOString()
      },
      FIXED_NOW
    );
    const session = await readyToRenderSession(executionSessionRepository, project.projectId, workerId);

    const result = await dispatchJob(
      { jobRepository, workerRepository, projectRepository, executionPlanRepository, executionSessionRepository, assetRepository, now: () => FIXED_NOW, staleAfterMs: STALE_AFTER_MS },
      { operation: "RENDER", workerId, projectId: project.projectId, executionSessionId: session.id, variant: "LANDSCAPE" }
    );

    const job = await jobRepository.findById(result.jobId);
    expect(job?.projectId).toBe(project.projectId);
    const payload = job?.payload as Record<string, unknown>;
    expect(payload.executionSessionId).toBe(session.id);
    expect(payload.expectedWorkingProjectSha256).toBe("d".repeat(64));
    expect(payload.renderSettingsTemplateName).toBe("Best Settings");
    expect(payload.checkpoint).toBeNull();
  });

  it("rejects with PreconditionNotMetError when no working copy has been produced yet - never queues a job anyway", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const executionSessionRepository = new InMemoryExecutionSessionRepository();
    const workerId = await setupWorkerWithCapability(workerRepository, "RENDER");
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: manifestWithTextPlaceholder() });
    const plan = await executionPlanRepository.createRevision(
      {
        id: "plan-1",
        projectId: project.projectId,
        revision: 1,
        status: "APPROVED",
        templateId: "tmpl-1",
        sourceProjectSha256: "a".repeat(64),
        scenePlans: [approvedTextScene()],
        approvedAt: FIXED_NOW,
        approvedBy: "user-1"
      },
      FIXED_NOW
    );
    await executionPlanRepository.updateRenderOutput(
      plan.id,
      "LANDSCAPE",
      {
        manifestCompositionId: "comp-1",
        aeProjectItemIndex: 5,
        compositionName: "Scene 01",
        sourceProjectSha256: "a".repeat(64),
        renderSettingsTemplateName: "Best Settings",
        outputModuleTemplateName: "H.264 - Match Source",
        configuredAt: FIXED_NOW.toISOString()
      },
      FIXED_NOW
    );
    // A fresh session with no scene completed yet - no EXECUTE_FRAME job has ever succeeded for it.
    const session = await createSession(executionSessionRepository, project.projectId, workerId);

    await expect(
      dispatchJob(
        { jobRepository, workerRepository, projectRepository, executionPlanRepository, executionSessionRepository, assetRepository: new InMemoryAssetRepository(), now: () => FIXED_NOW, staleAfterMs: STALE_AFTER_MS },
        { operation: "RENDER", workerId, projectId: project.projectId, executionSessionId: session.id, variant: "LANDSCAPE" }
      )
    ).rejects.toThrow(PreconditionNotMetError);
  });
});

describe("dispatchJob - INSPECT_RENDER_CAPABILITIES (safe dispatch, read-only)", () => {
  it("creates a QUEUED job with no projectId - INSPECT_RENDER_CAPABILITIES is not project-bound", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupWorkerWithCapability(workerRepository, "INSPECT_RENDER_CAPABILITIES");

    const result = await dispatchJob(deps(jobRepository, workerRepository), {
      operation: "INSPECT_RENDER_CAPABILITIES",
      workerId,
      payload: {}
    });

    expect(result.status).toBe("QUEUED");
    const job = await jobRepository.findById(result.jobId);
    expect(job?.projectId).toBeNull();
  });

  it("applies the same AE/MCP-ONLINE precondition as every other ae-mcp-touching operation", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = randomUUID();
    await workerRepository.create(
      { id: workerId, name: "Worker", tokenHash: "hash", maxConcurrency: 1, capabilities: ["INSPECT_RENDER_CAPABILITIES"] },
      FIXED_NOW
    );
    await workerRepository.updateHeartbeat(workerId, { aeStatus: "OFFLINE", mcpStatus: "ONLINE", aeVersion: null, currentJobId: null }, FIXED_NOW);

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), { operation: "INSPECT_RENDER_CAPABILITIES", workerId, payload: {} })
    ).rejects.toThrow(PreconditionNotMetError);
  });
});
