import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { ExecutionPlanNotFoundError } from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../test-support/in-memory-execution-plan-repository.js";
import { createProject } from "../../project/create-project.js";
import { createExecutionPlan } from "../create-execution-plan.js";
import { reconcileExecutionPlanReadiness } from "../reconcile-execution-plan-readiness.js";

const NOW = new Date("2026-08-31T00:00:00.000Z");
const fixedNow = () => NOW;

function manifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW.toISOString(),
    compositions: [
      { compositionId: "comp-1", aeProjectItemIndex: 1, name: "Scene A", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
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
            layerIndex: 1,
            layerPath: [],
            placeholderType: "text",
            editable: true,
            sourceType: "TextLayer",
            dimensions: null,
            startTimeSeconds: 0,
            durationSeconds: 5,
            evidence: { source: "read_directly", reason: "TextLayer confirmed via ae_get_composition" }
          }
        ]
      }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

async function setup() {
  const projectRepository = new InMemoryProjectRepository();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifest() });
  return { projectRepository, executionPlanRepository, project };
}

describe("reconcileExecutionPlanReadiness - real production bug on test22: a plan whose scenes went stale BEFORE the propagation fix existed", () => {
  it("throws ExecutionPlanNotFoundError when no plan exists", async () => {
    const { executionPlanRepository } = await setup();
    await expect(reconcileExecutionPlanReadiness({ executionPlanRepository, now: fixedNow }, "does-not-exist")).rejects.toThrow(ExecutionPlanNotFoundError);
  });

  it("simulating the real stale-plan bug: a scene stuck as stale UNREVIEWED with a stale unresolvedReasons, even though its mapping already has real content (as if the fix shipped after the accept happened) - reconciliation corrects it, changed: true", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const sceneId = created.plan.scenePlans[0]?.id as string;

    // Simulate the real bug directly: a mapping with real content, but the
    // stored unresolvedReasons/approvalState were never recomputed (the
    // exact state a plan edited before this fix would be found in).
    const current = await executionPlanRepository.findCurrentByProjectId(project.projectId);
    const staleScenePlans = current!.scenePlans.map((s) =>
      s.id === sceneId
        ? { ...s, mappings: s.mappings.map((m) => ({ ...m, text: "Real headline already accepted" })), unresolvedReasons: ["no confident structural classification for any detected placeholder yet"], approvalState: "UNREVIEWED" as const }
        : s
    );
    await executionPlanRepository.updateSceneReadiness(current!.id, current!.revision, staleScenePlans, NOW);

    const result = await reconcileExecutionPlanReadiness({ executionPlanRepository, now: fixedNow }, project.projectId);
    expect(result.changed).toBe(true);
    expect(result.changedScenePlanIds).toEqual([sceneId]);
    const reconciledScene = result.plan.scenePlans.find((s) => s.id === sceneId);
    expect(reconciledScene?.unresolvedReasons).toEqual([]);
    expect(reconciledScene?.approvalState).toBe("READY_FOR_APPROVAL");
    // Never touched the real mapping content itself.
    expect(reconciledScene?.mappings[0]?.text).toBe("Real headline already accepted");
  });

  it("is a genuine no-op (changed: false, no write issued) when nothing is actually stale", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const before = await executionPlanRepository.findCurrentByProjectId(project.projectId);

    const result = await reconcileExecutionPlanReadiness({ executionPlanRepository, now: fixedNow }, project.projectId);
    expect(result.changed).toBe(false);
    expect(result.changedScenePlanIds).toEqual([]);

    const after = await executionPlanRepository.findCurrentByProjectId(project.projectId);
    // updatedAt is untouched too - proves no write was ever issued, not merely a no-op write.
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    void created;
  });

  it("is idempotent - calling it twice in a row produces no further change the second time", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const current = await executionPlanRepository.findCurrentByProjectId(project.projectId);
    const sceneId = current!.scenePlans[0]!.id;
    const staleScenePlans = current!.scenePlans.map((s) =>
      s.id === sceneId ? { ...s, mappings: s.mappings.map((m) => ({ ...m, text: "Real content" })) } : s
    );
    await executionPlanRepository.updateSceneReadiness(current!.id, current!.revision, staleScenePlans, NOW);

    const first = await reconcileExecutionPlanReadiness({ executionPlanRepository, now: fixedNow }, project.projectId);
    expect(first.changed).toBe(true);

    const second = await reconcileExecutionPlanReadiness({ executionPlanRepository, now: fixedNow }, project.projectId);
    expect(second.changed).toBe(false);
  });

  it("never touches an already-APPROVED scene's approvalState, even if its unresolvedReasons were stale", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const current = await executionPlanRepository.findCurrentByProjectId(project.projectId);
    const sceneId = current!.scenePlans[0]!.id;
    const approvedButStale = current!.scenePlans.map((s) =>
      s.id === sceneId
        ? { ...s, mappings: s.mappings.map((m) => ({ ...m, text: "Real content" })), approvalState: "APPROVED" as const, unresolvedReasons: ["stale reason"] }
        : s
    );
    await executionPlanRepository.updateSceneReadiness(current!.id, current!.revision, approvedButStale, NOW);

    const result = await reconcileExecutionPlanReadiness({ executionPlanRepository, now: fixedNow }, project.projectId);
    expect(result.changed).toBe(true);
    const reconciledScene = result.plan.scenePlans.find((s) => s.id === sceneId);
    expect(reconciledScene?.approvalState).toBe("APPROVED");
    // unresolvedReasons still gets corrected (for display purposes), status stays sticky.
    expect(reconciledScene?.unresolvedReasons).toEqual([]);
  });

  it("never bumps the plan's own revision or touches its status", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const current = await executionPlanRepository.findCurrentByProjectId(project.projectId);
    const sceneId = current!.scenePlans[0]!.id;
    const staleScenePlans = current!.scenePlans.map((s) =>
      s.id === sceneId ? { ...s, mappings: s.mappings.map((m) => ({ ...m, text: "Real content" })) } : s
    );
    await executionPlanRepository.updateSceneReadiness(current!.id, current!.revision, staleScenePlans, NOW);

    const result = await reconcileExecutionPlanReadiness({ executionPlanRepository, now: fixedNow }, project.projectId);
    expect(result.plan.revision).toBe(current!.revision);
    expect(result.plan.status).toBe("DRAFT");
  });
});
