import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryJobRepository } from "../../job/test-support/in-memory-job-repository.js";
import { InMemoryExecutionPlanRepository } from "../test-support/in-memory-execution-plan-repository.js";
import { createProject } from "../../project/create-project.js";
import { createExecutionPlan } from "../create-execution-plan.js";
import { listRenderTemplates } from "../list-render-templates.js";
import { setRenderOutputConfig } from "../set-render-output-config.js";
import { ExecutionPlanEditError } from "../../../errors/app-error.js";
import type { WorkerRepository } from "../../../domain/worker/types.js";

const NOW = new Date("2026-10-21T09:40:55.000Z");
const fixedNow = () => NOW;
const WORKER_ID = "345ee0a4-ef4d-4b87-a923-726f97144aa4";

function manifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW.toISOString(),
    compositions: [{ compositionId: "comp-main", aeProjectItemIndex: 1, name: "!MAIN", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }],
    scenes: [{ sceneId: "scene-a", displayName: null, compositionId: "comp-main", originalOrderIndex: 0, startTimeSeconds: 0, durationSeconds: 5, placeholders: [] }],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

const workerRepository = { findById: async (id: string) => (id === WORKER_ID ? { id, name: "DESKTOP-A629N4N" } : null) } as unknown as WorkerRepository;

async function setup(sourceWorkerId: string | null = WORKER_ID) {
  const projectRepository = new InMemoryProjectRepository();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const jobRepository = new InMemoryJobRepository();
  const project = await createProject({ projectRepository, now: fixedNow }, { name: "שני טסט לבן2", manifest: manifest(), sourceWorkerId });
  await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
  return { projectRepository, executionPlanRepository, jobRepository, project };
}

// What the client's After Effects really reported on 2026-10-21 (job 8c2438df).
const REPORTED = {
  aeVersion: null,
  renderSettingsTemplateNames: ["Best Settings", "Current Settings", "Draft Settings", "Reels"],
  outputModuleTemplateNames: ["H.264 - Match Render Settings - 15 Mbps", "High Quality", "Lossless"],
  capturedAt: NOW.toISOString()
};

async function reported(jobRepository: InMemoryJobRepository, status: "SUCCEEDED" | "FAILED" = "SUCCEEDED") {
  const job = await jobRepository.create({ id: `job-${status}-${Math.random()}`, workerId: WORKER_ID, projectId: null, createdByUserId: null, operation: "INSPECT_RENDER_CAPABILITIES", payload: {} }, NOW);
  await jobRepository.updateStatus(job.id, WORKER_ID, { expectedCurrentStatus: "QUEUED", status: "CLAIMED" }, NOW);
  await jobRepository.updateStatus(job.id, WORKER_ID, { expectedCurrentStatus: "CLAIMED", status: "RUNNING" }, NOW);
  await jobRepository.updateStatus(
    job.id,
    WORKER_ID,
    status === "SUCCEEDED"
      ? { expectedCurrentStatus: "RUNNING", status, result: REPORTED }
      : { expectedCurrentStatus: "RUNNING", status, error: { code: "INTERNAL_ERROR", message: "x" } },
    NOW
  );
}

describe("listRenderTemplates - the names the project's worker's After Effects last reported (2026-10-21)", () => {
  it("returns the newest successful report for the project's own worker, with the worker's name", async () => {
    const { projectRepository, jobRepository, project } = await setup();
    await reported(jobRepository);
    const result = await listRenderTemplates({ projectRepository, jobRepository, workerRepository }, project.projectId);
    expect(result.templates?.workerName).toBe("DESKTOP-A629N4N");
    expect(result.templates?.renderSettingsTemplateNames).toContain("Reels");
    expect(result.templates?.outputModuleTemplateNames).not.toContain("Reels");
  });

  it("is null when the project has no recorded worker, or that worker never reported successfully", async () => {
    const noWorker = await setup(null);
    expect((await listRenderTemplates({ projectRepository: noWorker.projectRepository, jobRepository: noWorker.jobRepository, workerRepository }, noWorker.project.projectId)).templates).toBeNull();
    const failedOnly = await setup();
    await reported(failedOnly.jobRepository, "FAILED");
    expect((await listRenderTemplates({ projectRepository: failedOnly.projectRepository, jobRepository: failedOnly.jobRepository, workerRepository }, failedOnly.project.projectId)).templates).toBeNull();
  });
});

describe("setRenderOutputConfig - a template name the worker's After Effects does not have is refused at save time (2026-10-21)", () => {
  it("refuses the client's exact mistake, naming the real list, and saves a name that is on it", async () => {
    const { projectRepository, executionPlanRepository, jobRepository, project } = await setup();
    await reported(jobRepository);
    const deps = { executionPlanRepository, projectRepository, now: fixedNow, renderTemplates: { jobRepository, workerRepository } };

    const attempt = setRenderOutputConfig(deps, project.projectId, "REELS", { manifestCompositionId: "comp-main", renderSettingsTemplateName: "Reels", outputModuleTemplateName: "Reels" });
    await expect(attempt).rejects.toThrow(ExecutionPlanEditError);
    await expect(attempt).rejects.toThrow(/After Effects on DESKTOP-A629N4N does not have an Output Module template named "Reels" \(it has: H\.264 - Match Render Settings - 15 Mbps/);

    const saved = await setRenderOutputConfig(deps, project.projectId, "REELS", { manifestCompositionId: "comp-main", renderSettingsTemplateName: "Reels", outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps" });
    expect(saved.plan.renderOutputs.REELS?.outputModuleTemplateName).toBe("H.264 - Match Render Settings - 15 Mbps");
  });

  it("saves as typed while the worker has never reported its templates - nothing is guessed", async () => {
    const { projectRepository, executionPlanRepository, jobRepository, project } = await setup();
    const saved = await setRenderOutputConfig({ executionPlanRepository, projectRepository, now: fixedNow, renderTemplates: { jobRepository, workerRepository } }, project.projectId, "LANDSCAPE", { manifestCompositionId: "comp-main", renderSettingsTemplateName: "Anything", outputModuleTemplateName: "Typed" });
    expect(saved.plan.renderOutputs.LANDSCAPE?.renderSettingsTemplateName).toBe("Anything");
  });
});
