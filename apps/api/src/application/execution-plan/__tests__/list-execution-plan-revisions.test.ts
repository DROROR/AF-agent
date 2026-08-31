import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { ExecutionPlanNotFoundError } from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../test-support/in-memory-execution-plan-repository.js";
import { InMemoryAssetRepository } from "../../asset/test-support/in-memory-asset-repository.js";
import { createProject } from "../../project/create-project.js";
import { createExecutionPlan } from "../create-execution-plan.js";
import { updateExecutionPlan } from "../update-execution-plan.js";
import { approveExecutionPlan } from "../approve-execution-plan.js";
import { listExecutionPlanRevisions } from "../list-execution-plan-revisions.js";
import type { BrandRulesConfig } from "../../../domain/brand-rules/validate-brand-rules.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const fixedNow = () => NOW;
const USER_ID = "11111111-1111-1111-1111-111111111111";
/** This file tests revision listing, not brand-rule content - see execution-plan-lifecycle.test.ts's identical constant for why. */
const PERMISSIVE_BRAND_RULES: BrandRulesConfig = { requireLogoPresence: false, requiredHebrewText: "", dyoBlueHex: null, rtlPreservedByConstruction: true };

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
        durationSeconds: 5,
        startTimeSeconds: 0,
        // Resolved (non-"unknown") placeholder - approveExecutionPlan
        // below expects to succeed, which now requires readiness too.
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
  const assetRepository = new InMemoryAssetRepository();
  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifest() });
  return { projectRepository, executionPlanRepository, assetRepository, project };
}

describe("listExecutionPlanRevisions", () => {
  it("throws ExecutionPlanNotFoundError when no plan exists for the project", async () => {
    const { executionPlanRepository, project } = await setup();
    await expect(listExecutionPlanRevisions({ executionPlanRepository }, project.projectId)).rejects.toThrow(
      ExecutionPlanNotFoundError
    );
  });

  it("returns exactly one revision summary for a freshly-created plan, marked current", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);

    const result = await listExecutionPlanRevisions({ executionPlanRepository }, project.projectId);
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({ revision: 1, status: "DRAFT", sceneCount: 1, isCurrent: true });
  });

  it("returns every prior revision (never just the latest), newest first, with only the latest marked current", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const scenePlanId = created.plan.scenePlans[0]!.id;
    await updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
      baseRevision: 1,
      operations: [{ type: "SET_INSTRUCTIONS", scenePlanId, instructions: "x" }]
    });

    const result = await listExecutionPlanRevisions({ executionPlanRepository }, project.projectId);
    expect(result.revisions).toHaveLength(2);
    expect(result.revisions.map((r) => r.revision)).toEqual([2, 1]);
    expect(result.revisions.filter((r) => r.isCurrent)).toEqual([expect.objectContaining({ revision: 2, isCurrent: true })]);
  });

  it("never leaks full scenePlans - only a scene count", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const result = await listExecutionPlanRevisions({ executionPlanRepository }, project.projectId);
    expect(result.revisions[0]).not.toHaveProperty("scenePlans");
  });

  it("reflects an approval transition without creating a new revision (approve is in-place)", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const sceneId = created.plan.scenePlans[0]?.id as string;
    const mappingId = created.plan.scenePlans[0]?.mappings[0]?.id as string;
    // A real content decision - readiness must genuinely pass (mapping-review propagation fix).
    const withDecision = await updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
      baseRevision: created.plan.revision,
      operations: [{ type: "SET_TEXT", scenePlanId: sceneId, mappingId, text: "Real headline" }]
    });
    await approveExecutionPlan(
      { executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: PERMISSIVE_BRAND_RULES },
      project.projectId,
      USER_ID,
      { baseRevision: withDecision.plan.revision }
    );

    const result = await listExecutionPlanRevisions({ executionPlanRepository }, project.projectId);
    expect(result.revisions).toHaveLength(2);
    const current = result.revisions.find((r) => r.isCurrent);
    expect(current).toMatchObject({ revision: withDecision.plan.revision, status: "APPROVED", isCurrent: true });
  });
});
