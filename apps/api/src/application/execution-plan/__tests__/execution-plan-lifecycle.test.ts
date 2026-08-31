import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import {
  AssetCrossProjectAccessError,
  AssetNotFoundError,
  ExecutionPlanAlreadyExistsError,
  ExecutionPlanEditError,
  PreconditionNotMetError,
  ProjectNotFoundError,
  SourceShaMismatchError,
  StaleExecutionPlanRevisionError
} from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../test-support/in-memory-execution-plan-repository.js";
import { InMemoryAssetRepository } from "../../asset/test-support/in-memory-asset-repository.js";
import { createProject } from "../../project/create-project.js";
import { createExecutionPlan } from "../create-execution-plan.js";
import { getExecutionPlan } from "../get-execution-plan.js";
import { updateExecutionPlan } from "../update-execution-plan.js";
import { approveExecutionPlan } from "../approve-execution-plan.js";
import { rejectExecutionPlan } from "../reject-execution-plan.js";
import { reopenExecutionPlan } from "../reopen-execution-plan.js";
import type { BrandRulesConfig } from "../../../domain/brand-rules/validate-brand-rules.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const fixedNow = () => NOW;
const USER_ID = "11111111-1111-1111-1111-111111111111";
/** This file tests revision/staleness/concurrency behavior, not brand-rule content - fixtures below deliberately don't carry a logo/Hebrew-text mapping, so every rule here is disabled. Brand-rule enforcement itself is covered by validate-brand-rules.test.ts and approve-execution-plan-brand-rules.test.ts. */
const PERMISSIVE_BRAND_RULES: BrandRulesConfig = { requireLogoPresence: false, requiredHebrewText: "", dyoBlueHex: null, rtlPreservedByConstruction: true };

function manifest(sha256 = "a".repeat(64)): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256 },
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
        // A real, resolved (non-"unknown") placeholder - so this scene has
        // no unresolvedReasons by default and approveExecutionPlan can
        // succeed in the tests below that expect it to. See
        // getExecutionPlanReadiness's own dedicated tests for the
        // unresolved-rejection case.
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

/** No placeholders at all - build-execution-plan.ts's real logic leaves this scene's unresolvedReasons non-empty, matching the real White App Promo plan's current state (every scene still unresolved). */
function unresolvedManifest(sha256 = "a".repeat(64)): TemplateManifest {
  const base = manifest(sha256);
  return { ...base, scenes: base.scenes.map((scene) => ({ ...scene, placeholders: [] })) };
}

async function setup(manifestForProject: TemplateManifest = manifest()) {
  const projectRepository = new InMemoryProjectRepository();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const assetRepository = new InMemoryAssetRepository();
  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifestForProject });
  return { projectRepository, executionPlanRepository, assetRepository, project };
}

describe("execution plan lifecycle", () => {
  it("creates revision 1 in DRAFT status, bound to the project's source sha256", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    const result = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    expect(result.plan.revision).toBe(1);
    expect(result.plan.status).toBe("DRAFT");
    expect(result.plan.sourceProjectSha256).toBe("a".repeat(64));
    expect(result.plan.scenePlans).toHaveLength(1);
  });

  it("refuses to create a second plan for the same project - use GET/update instead", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    await expect(createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId)).rejects.toThrow(
      ExecutionPlanAlreadyExistsError
    );
  });

  it("throws ProjectNotFoundError for a nonexistent project", async () => {
    const { projectRepository, executionPlanRepository } = await setup();
    await expect(createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, "does-not-exist")).rejects.toThrow(
      ProjectNotFoundError
    );
  });

  it("GET returns the current (highest-revision) plan", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const result = await getExecutionPlan({ executionPlanRepository }, project.projectId);
    expect(result.plan.revision).toBe(1);
    expect(result.sceneTable).toHaveLength(1);
  });

  it("update creates a new revision and rejects a stale baseRevision", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);

    await expect(
      updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
        baseRevision: 999,
        operations: [{ type: "EXCLUDE_SCENE", scenePlanId: "irrelevant" }]
      })
    ).rejects.toThrow(StaleExecutionPlanRevisionError);

    const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, "unused").catch(() => null);
    expect(created).toBeNull(); // sanity: unrelated call still fails normally, not a side effect of the above
  });

  it("a valid update bumps the revision and applies the edit", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const initial = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const sceneId = initial.plan.scenePlans[0]?.id as string;

    const updated = await updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
      baseRevision: 1,
      operations: [{ type: "EXCLUDE_SCENE", scenePlanId: sceneId }]
    });
    expect(updated.plan.revision).toBe(2);
    expect(updated.plan.scenePlans[0]?.use).toBe(false);
  });

  it("SET_LAYER_VISIBILITY resolves through the full stack: persists onto the correct mapping and bumps the revision", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const initial = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const sceneId = initial.plan.scenePlans[0]?.id as string;
    const mappingId = initial.plan.scenePlans[0]?.mappings[0]?.id as string;

    const updated = await updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
      baseRevision: 1,
      operations: [{ type: "SET_LAYER_VISIBILITY", scenePlanId: sceneId, mappingId, enabled: false }]
    });
    expect(updated.plan.revision).toBe(2);
    expect(updated.plan.scenePlans[0]?.mappings[0]?.layerVisible).toBe(false);
  });

  it("rejects a stale baseRevision for one of the newly-resolvable operations too (SET_LAYER_VISIBILITY) - the same generic revision check applies to every operation type", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const initial = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const sceneId = initial.plan.scenePlans[0]?.id as string;
    const mappingId = initial.plan.scenePlans[0]?.mappings[0]?.id as string;

    await expect(
      updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
        baseRevision: 999,
        operations: [{ type: "SET_LAYER_VISIBILITY", scenePlanId: sceneId, mappingId, enabled: false }]
      })
    ).rejects.toThrow(StaleExecutionPlanRevisionError);
  });

  it("rejects SET_BRAND_COLOR against an unsupported (non-color-classified) target mapping through the full stack", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const initial = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const sceneId = initial.plan.scenePlans[0]?.id as string;
    const mappingId = initial.plan.scenePlans[0]?.mappings[0]?.id as string; // this fixture's mapping is classified "text", not "color"

    await expect(
      updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
        baseRevision: 1,
        operations: [{ type: "SET_BRAND_COLOR", scenePlanId: sceneId, mappingId, colorHex: "#1A2B3C" }]
      })
    ).rejects.toThrow(ExecutionPlanEditError);
  });

  it("rejects an update whose edit operation references an unknown scenePlanId", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);

    await expect(
      updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
        baseRevision: 1,
        operations: [{ type: "EXCLUDE_SCENE", scenePlanId: "does-not-exist" }]
      })
    ).rejects.toThrow(ExecutionPlanEditError);
  });

  it("approve is an in-place status change - revision does not change", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const sceneId = created.plan.scenePlans[0]?.id as string;
    const mappingId = created.plan.scenePlans[0]?.mappings[0]?.id as string;
    // A real content decision - readiness must genuinely pass (mapping-review propagation fix).
    const withDecision = await updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
      baseRevision: 1,
      operations: [{ type: "SET_TEXT", scenePlanId: sceneId, mappingId, text: "Real headline" }]
    });

    const approved = await approveExecutionPlan(
      { executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: PERMISSIVE_BRAND_RULES },
      project.projectId,
      USER_ID,
      { baseRevision: withDecision.plan.revision }
    );
    expect(approved.plan.status).toBe("APPROVED");
    expect(approved.plan.revision).toBe(withDecision.plan.revision);
    expect(approved.plan.approvedBy).toBe(USER_ID);
    expect(approved.plan.approvedAt).toBe(NOW.toISOString());
  });

  it("refuses to approve when the plan's sourceProjectSha256 no longer matches the project's current manifest", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);

    // The client re-ran INSPECT_TEMPLATE and the project's manifest was replaced with a different source revision.
    await projectRepository.updateManifest(project.projectId, manifest("b".repeat(64)), NOW);

    await expect(
      approveExecutionPlan({ executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: PERMISSIVE_BRAND_RULES }, project.projectId, USER_ID, { baseRevision: 1 })
    ).rejects.toThrow(SourceShaMismatchError);
  });

  it("an edit after APPROVED resets status to DRAFT on the new revision - never silently stays approved", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const initial = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const sceneId = initial.plan.scenePlans[0]?.id as string;
    const mappingId = initial.plan.scenePlans[0]?.mappings[0]?.id as string;
    const withDecision = await updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
      baseRevision: 1,
      operations: [{ type: "SET_TEXT", scenePlanId: sceneId, mappingId, text: "Real headline" }]
    });
    await approveExecutionPlan(
      { executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: PERMISSIVE_BRAND_RULES },
      project.projectId,
      USER_ID,
      { baseRevision: withDecision.plan.revision }
    );

    const updated = await updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
      baseRevision: withDecision.plan.revision,
      operations: [{ type: "EXCLUDE_SCENE", scenePlanId: sceneId }]
    });
    expect(updated.plan.revision).toBe(withDecision.plan.revision + 1);
    expect(updated.plan.status).toBe("DRAFT");
    expect(updated.plan.approvedAt).toBeNull();
    expect(updated.plan.approvedBy).toBeNull();
  });

  it("reject sets status to REJECTED in place; reopen returns it to DRAFT in place", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);

    const rejected = await rejectExecutionPlan({ executionPlanRepository, now: fixedNow }, project.projectId, { baseRevision: 1 });
    expect(rejected.plan.status).toBe("REJECTED");
    expect(rejected.plan.revision).toBe(1);

    const reopened = await reopenExecutionPlan({ executionPlanRepository, now: fixedNow }, project.projectId, { baseRevision: 1 });
    expect(reopened.plan.status).toBe("DRAFT");
    expect(reopened.plan.revision).toBe(1);
  });

  it("stale revision is rejected for approve/reject/reopen too, not just update", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);

    await expect(
      approveExecutionPlan({ executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: PERMISSIVE_BRAND_RULES }, project.projectId, USER_ID, { baseRevision: 2 })
    ).rejects.toThrow(StaleExecutionPlanRevisionError);
    await expect(
      rejectExecutionPlan({ executionPlanRepository, now: fixedNow }, project.projectId, { baseRevision: 2 })
    ).rejects.toThrow(StaleExecutionPlanRevisionError);
    await expect(
      reopenExecutionPlan({ executionPlanRepository, now: fixedNow }, project.projectId, { baseRevision: 2 })
    ).rejects.toThrow(StaleExecutionPlanRevisionError);
  });

  it("refuses to approve a plan with an unresolved scene marked for use - real backend enforcement, not just a UI restriction", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup(unresolvedManifest());
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);

    const attempt = approveExecutionPlan(
      { executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: PERMISSIVE_BRAND_RULES },
      project.projectId,
      USER_ID,
      { baseRevision: 1 }
    );
    await expect(attempt).rejects.toThrow(PreconditionNotMetError);
    await expect(attempt).rejects.toThrow(/1 scene\(s\)/);

    // The plan must remain exactly as it was - never partially approved.
    const stillDraft = await getExecutionPlan({ executionPlanRepository }, project.projectId);
    expect(stillDraft.plan.status).toBe("DRAFT");
    expect(stillDraft.plan.revision).toBe(1);
  });

  it("does not count an excluded scene's unresolved reason against approval readiness", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup(unresolvedManifest());
    const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const sceneId = created.plan.scenePlans[0]?.id as string;

    // Excluding the one unresolved scene means nothing marked for use is unresolved anymore.
    const updated = await updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
      baseRevision: 1,
      operations: [{ type: "EXCLUDE_SCENE", scenePlanId: sceneId }]
    });
    expect(updated.plan.revision).toBe(2);

    const approved = await approveExecutionPlan(
      { executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: PERMISSIVE_BRAND_RULES },
      project.projectId,
      USER_ID,
      { baseRevision: 2 }
    );
    expect(approved.plan.status).toBe("APPROVED");
  });

  it("refuses to re-approve a plan that is already APPROVED (plan not in an eligible state)", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const sceneId = created.plan.scenePlans[0]?.id as string;
    const mappingId = created.plan.scenePlans[0]?.mappings[0]?.id as string;
    const withDecision = await updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
      baseRevision: 1,
      operations: [{ type: "SET_TEXT", scenePlanId: sceneId, mappingId, text: "Real headline" }]
    });
    await approveExecutionPlan(
      { executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: PERMISSIVE_BRAND_RULES },
      project.projectId,
      USER_ID,
      { baseRevision: withDecision.plan.revision }
    );

    await expect(
      approveExecutionPlan(
        { executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: PERMISSIVE_BRAND_RULES },
        project.projectId,
        USER_ID,
        { baseRevision: withDecision.plan.revision }
      )
    ).rejects.toThrow(PreconditionNotMetError);
  });

  it("refuses to approve a REJECTED plan - must be reopened to DRAFT first", async () => {
    const { projectRepository, executionPlanRepository, project } = await setup();
    await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    await rejectExecutionPlan({ executionPlanRepository, now: fixedNow }, project.projectId, { baseRevision: 1 });

    await expect(
      approveExecutionPlan({ executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: PERMISSIVE_BRAND_RULES }, project.projectId, USER_ID, { baseRevision: 1 })
    ).rejects.toThrow(PreconditionNotMetError);
  });

  it("never mutates a prior revision's own row when approving the current one", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const sceneId = created.plan.scenePlans[0]?.id as string;
    const mappingId = created.plan.scenePlans[0]?.mappings[0]?.id as string;
    await updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
      baseRevision: 1,
      // A real content decision (mapping-review propagation fix) - this
      // scene's own Headline mapping must genuinely be resolved for
      // approval to succeed under the live readiness check, not merely
      // carry a note.
      operations: [
        { type: "SET_INSTRUCTIONS", scenePlanId: sceneId, instructions: "revision 1 note" },
        { type: "SET_TEXT", scenePlanId: sceneId, mappingId, text: "Real headline" }
      ]
    });

    await approveExecutionPlan({ executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: PERMISSIVE_BRAND_RULES }, project.projectId, USER_ID, { baseRevision: 2 });

    const revisions = await executionPlanRepository.findAllByProjectId(project.projectId);
    const revisionOne = revisions.find((r) => r.revision === 1);
    expect(revisionOne?.status).toBe("DRAFT");
    expect(revisionOne?.approvedAt).toBeNull();
    expect(revisionOne?.scenePlans[0]?.instructions).toBeNull();
  });

  it("MAP_ASSET succeeds for a real asset that belongs to this exact project", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const scenePlanId = created.plan.scenePlans[0]?.id as string;
    const mappingId = created.plan.scenePlans[0]?.mappings[0]?.id as string;
    const asset = await assetRepository.create(
      {
        id: "11111111-1111-1111-1111-111111111112",
        projectId: project.projectId,
        originalFilename: "logo.png",
        storageKey: `${project.projectId}/asset.png`,
        mediaKind: "IMAGE",
        mimeType: "image/png",
        byteSize: 10,
        sha256: "a".repeat(64),
        width: null,
        height: null,
        durationSeconds: null,
        label: null,
        notes: null
      },
      NOW
    );

    const updated = await updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
      baseRevision: 1,
      operations: [{ type: "MAP_ASSET", scenePlanId, mappingId, selectedAssetId: asset.id, selectedAssetType: "image" }]
    });
    expect(updated.plan.scenePlans[0]?.mappings[0]?.selectedAssetId).toBe(asset.id);
  });

  it("MAP_ASSET rejects an asset that belongs to a DIFFERENT project - never confirms it exists elsewhere", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const scenePlanId = created.plan.scenePlans[0]?.id as string;
    const mappingId = created.plan.scenePlans[0]?.mappings[0]?.id as string;
    const asset = await assetRepository.create(
      {
        id: "11111111-1111-1111-1111-111111111113",
        projectId: "22222222-2222-2222-2222-222222222222",
        originalFilename: "logo.png",
        storageKey: "22222222-2222-2222-2222-222222222222/asset.png",
        mediaKind: "IMAGE",
        mimeType: "image/png",
        byteSize: 10,
        sha256: "a".repeat(64),
        width: null,
        height: null,
        durationSeconds: null,
        label: null,
        notes: null
      },
      NOW
    );

    await expect(
      updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
        baseRevision: 1,
        operations: [{ type: "MAP_ASSET", scenePlanId, mappingId, selectedAssetId: asset.id, selectedAssetType: "image" }]
      })
    ).rejects.toThrow(AssetCrossProjectAccessError);

    // Refused before anything is applied - the plan is untouched.
    const stillDraft = await getExecutionPlan({ executionPlanRepository }, project.projectId);
    expect(stillDraft.plan.revision).toBe(1);
    expect(stillDraft.plan.scenePlans[0]?.mappings[0]?.selectedAssetId).toBeNull();
  });

  it("MAP_ASSET rejects an asset id that does not exist at all", async () => {
    const { projectRepository, executionPlanRepository, assetRepository, project } = await setup();
    const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
    const scenePlanId = created.plan.scenePlans[0]?.id as string;
    const mappingId = created.plan.scenePlans[0]?.mappings[0]?.id as string;

    await expect(
      updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
        baseRevision: 1,
        operations: [{ type: "MAP_ASSET", scenePlanId, mappingId, selectedAssetId: "does-not-exist", selectedAssetType: "image" }]
      })
    ).rejects.toThrow(AssetNotFoundError);
  });
});
