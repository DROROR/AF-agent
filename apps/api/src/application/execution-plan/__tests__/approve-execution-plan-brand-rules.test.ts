import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { PreconditionNotMetError } from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../test-support/in-memory-execution-plan-repository.js";
import { InMemoryAssetRepository } from "../../asset/test-support/in-memory-asset-repository.js";
import { createProject } from "../../project/create-project.js";
import { createExecutionPlan } from "../create-execution-plan.js";
import { updateExecutionPlan } from "../update-execution-plan.js";
import { approveExecutionPlan } from "../approve-execution-plan.js";
import type { BrandRulesConfig } from "../../../domain/brand-rules/validate-brand-rules.js";

const NOW = new Date("2026-08-29T00:00:00.000Z");
const fixedNow = () => NOW;
const USER_ID = "11111111-1111-1111-1111-111111111111";
const REAL_BRAND_RULES: BrandRulesConfig = {
  requireLogoPresence: true,
  requiredHebrewText: "מבית DYO App",
  dyoBlueHex: null,
  rtlPreservedByConstruction: true
};

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
  const assetRepository = new InMemoryAssetRepository();
  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifest() });
  const plan = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
  const mappingId = plan.plan.scenePlans[0]?.mappings[0]?.id as string;
  const sceneId = plan.plan.scenePlans[0]?.id as string;
  return { projectRepository, executionPlanRepository, assetRepository, project, mappingId, sceneId };
}

describe("approveExecutionPlan - permanent DYO brand rules (real backend gate, not a UI restriction)", () => {
  it("refuses to approve a plan missing the required logo and Hebrew text - CLAUDE.md's permanent brand rules", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();

    const attempt = approveExecutionPlan(
      { executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: REAL_BRAND_RULES },
      project.projectId,
      USER_ID,
      { baseRevision: 1 }
    );
    await expect(attempt).rejects.toThrow(PreconditionNotMetError);
    await expect(attempt).rejects.toThrow(/logo/i);
    await expect(attempt).rejects.toThrow(/מבית DYO App/);

    const stillDraft = await executionPlanRepository.findCurrentByProjectId(project.projectId);
    expect(stillDraft?.status).toBe("DRAFT");
  });

  it("approves once the required logo and the exact Hebrew text are both mapped", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project, mappingId, sceneId } = await setup();
    await assetRepository.create(
      {
        id: "asset-logo-1",
        projectId: project.projectId,
        originalFilename: "logo.png",
        storageKey: "assets/logo.png",
        mediaKind: "LOGO",
        mimeType: "image/png",
        byteSize: 1024,
        sha256: "b".repeat(64),
        width: 512,
        height: 512,
        durationSeconds: null,
        label: null,
        notes: null
      },
      NOW
    );

    await updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
      baseRevision: 1,
      operations: [
        { type: "SET_TEXT", scenePlanId: sceneId, mappingId, text: "מבית DYO App" },
        { type: "MAP_ASSET", scenePlanId: sceneId, mappingId, selectedAssetId: "asset-logo-1", selectedAssetType: "logo" }
      ]
    });

    const approved = await approveExecutionPlan(
      { executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: REAL_BRAND_RULES },
      project.projectId,
      USER_ID,
      { baseRevision: 2 }
    );
    expect(approved.plan.status).toBe("APPROVED");
  });

  it("defaults to reading the REAL dyo-brand-rules.yaml when no override is supplied - the production wiring path", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();

    // No brandRulesConfig override - exercises loadBrandRulesConfig()
    // against the real repo-root file, exactly as routes/projects.ts does
    // in production.
    await expect(
      approveExecutionPlan({ executionPlanRepository, projectRepository, now: fixedNow }, project.projectId, USER_ID, { baseRevision: 1 })
    ).rejects.toThrow(PreconditionNotMetError);
  });
});
