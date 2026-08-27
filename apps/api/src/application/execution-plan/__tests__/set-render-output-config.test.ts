import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { ExecutionPlanEditError, ExecutionPlanNotFoundError, SourceShaMismatchError } from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../test-support/in-memory-execution-plan-repository.js";
import { createProject } from "../../project/create-project.js";
import { createExecutionPlan } from "../create-execution-plan.js";
import { setRenderOutputConfig } from "../set-render-output-config.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const fixedNow = () => NOW;

function manifest(sha256 = "a".repeat(64)): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256 },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW.toISOString(),
    compositions: [
      { compositionId: "comp-landscape", aeProjectItemIndex: 3, name: "Landscape Master", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] },
      { compositionId: "comp-reels", aeProjectItemIndex: 7, name: "Reels Master", widthPx: 1080, heightPx: 1920, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
    ],
    scenes: [
      {
        sceneId: "scene-a",
        displayName: null,
        compositionId: "comp-landscape",
        originalOrderIndex: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
        placeholders: []
      }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

async function setup(manifestForProject: TemplateManifest = manifest()) {
  const projectRepository = new InMemoryProjectRepository();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifestForProject });
  await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
  return { projectRepository, executionPlanRepository, project };
}

describe("setRenderOutputConfig", () => {
  it("persists a LANDSCAPE configuration, resolving aeProjectItemIndex/compositionName from the real manifest", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();

    const result = await setRenderOutputConfig({ executionPlanRepository, projectRepository, now: fixedNow }, project.projectId, "LANDSCAPE", {
      manifestCompositionId: "comp-landscape",
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Source"
    });

    expect(result.plan.renderOutputs.LANDSCAPE).toEqual({
      manifestCompositionId: "comp-landscape",
      aeProjectItemIndex: 3,
      compositionName: "Landscape Master",
      sourceProjectSha256: "a".repeat(64),
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Source",
      configuredAt: NOW.toISOString()
    });
    expect(result.plan.renderOutputs.REELS).toBeNull();
  });

  it("persists a REELS configuration independently of LANDSCAPE", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();

    await setRenderOutputConfig({ executionPlanRepository, projectRepository, now: fixedNow }, project.projectId, "LANDSCAPE", {
      manifestCompositionId: "comp-landscape",
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Source"
    });
    const result = await setRenderOutputConfig({ executionPlanRepository, projectRepository, now: fixedNow }, project.projectId, "REELS", {
      manifestCompositionId: "comp-reels",
      renderSettingsTemplateName: "Reels Settings",
      outputModuleTemplateName: "H.264 - Reels"
    });

    expect(result.plan.renderOutputs.REELS?.compositionName).toBe("Reels Master");
    expect(result.plan.renderOutputs.REELS?.aeProjectItemIndex).toBe(7);
    // LANDSCAPE, configured separately above, is untouched by configuring REELS.
    expect(result.plan.renderOutputs.LANDSCAPE?.compositionName).toBe("Landscape Master");
  });

  it("rejects a manifestCompositionId that does not match any real composition in the current manifest", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();

    await expect(
      setRenderOutputConfig({ executionPlanRepository, projectRepository, now: fixedNow }, project.projectId, "LANDSCAPE", {
        manifestCompositionId: "does-not-exist",
        renderSettingsTemplateName: "Best Settings",
        outputModuleTemplateName: "H.264 - Match Source"
      })
    ).rejects.toThrow(ExecutionPlanEditError);
  });

  it("fails closed when the project's manifest sha256 no longer matches the plan's bound sourceProjectSha256", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();

    // The client re-ran INSPECT_TEMPLATE and the project's manifest was replaced with a different source revision.
    await projectRepository.updateManifest(project.projectId, manifest("b".repeat(64)), NOW);

    await expect(
      setRenderOutputConfig({ executionPlanRepository, projectRepository, now: fixedNow }, project.projectId, "LANDSCAPE", {
        manifestCompositionId: "comp-landscape",
        renderSettingsTemplateName: "Best Settings",
        outputModuleTemplateName: "H.264 - Match Source"
      })
    ).rejects.toThrow(SourceShaMismatchError);
  });

  it("throws ExecutionPlanNotFoundError when the project has no execution plan yet", async () => {
    const projectRepository = new InMemoryProjectRepository();
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const project = await createProject({ projectRepository, now: fixedNow }, { name: "No Plan Project", manifest: manifest() });

    await expect(
      setRenderOutputConfig({ executionPlanRepository, projectRepository, now: fixedNow }, project.projectId, "LANDSCAPE", {
        manifestCompositionId: "comp-landscape",
        renderSettingsTemplateName: "Best Settings",
        outputModuleTemplateName: "H.264 - Match Source"
      })
    ).rejects.toThrow(ExecutionPlanNotFoundError);
  });

  it("is an in-place update - the plan's own revision never changes", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();

    const result = await setRenderOutputConfig({ executionPlanRepository, projectRepository, now: fixedNow }, project.projectId, "LANDSCAPE", {
      manifestCompositionId: "comp-landscape",
      renderSettingsTemplateName: "Best Settings",
      outputModuleTemplateName: "H.264 - Match Source"
    });

    expect(result.plan.revision).toBe(1);
  });
});
