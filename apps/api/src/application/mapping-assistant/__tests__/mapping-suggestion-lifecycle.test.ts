import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import {
  StaleExecutionPlanRevisionError,
  SuggestedAssetInvalidError,
  SuggestionCrossProjectAccessError,
  SuggestionNotFoundError,
  SuggestionNotPendingError
} from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { createProject } from "../../project/create-project.js";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { createExecutionPlan } from "../../execution-plan/create-execution-plan.js";
import { InMemoryAssetRepository } from "../../asset/test-support/in-memory-asset-repository.js";
import { uploadAsset } from "../../asset/upload-asset.js";
import { InMemoryAssetStorage } from "../../asset/test-support/in-memory-asset-storage.js";
import { InMemoryMappingSuggestionRepository } from "../test-support/in-memory-mapping-suggestion-repository.js";
import { acceptMappingSuggestion } from "../accept-mapping-suggestion.js";
import { rejectMappingSuggestion } from "../reject-mapping-suggestion.js";
import { batchAcceptMappingSuggestions } from "../batch-accept-mapping-suggestions.js";
import type { NewMappingSuggestion } from "../../../domain/mapping-suggestion/types.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");
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
            layerName: "Hero Image",
            layerIndex: 1,
            layerPath: [],
            placeholderType: "image",
            editable: true,
            sourceType: "AVLayer",
            dimensions: null,
            startTimeSeconds: 0,
            durationSeconds: 5,
            evidence: { source: "read_directly", reason: "AVLayer confirmed via ae_get_composition" }
          },
          {
            placeholderId: "ph-2",
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
  const assetStorage = new InMemoryAssetStorage();
  const mappingSuggestionRepository = new InMemoryMappingSuggestionRepository();

  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifest() });
  const other = await createProject({ projectRepository, now: fixedNow }, { name: "Other Project", manifest: manifest() });
  const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
  const scenePlanId = created.plan.scenePlans[0]!.id;
  const mappingId = created.plan.scenePlans[0]!.mappings[0]!.id;
  const secondMappingId = created.plan.scenePlans[0]!.mappings[1]!.id;

  const asset = await uploadAsset(
    { assetRepository, assetStorage, projectRepository, maxUploadBytes: 1000, now: fixedNow },
    project.projectId,
    { originalFilename: "hero.png", mimeType: "image/png", buffer: Buffer.from("bytes"), requestedMediaKind: null }
  );

  return {
    projectRepository,
    executionPlanRepository,
    assetRepository,
    assetStorage,
    mappingSuggestionRepository,
    now: fixedNow,
    project,
    other,
    scenePlanId,
    mappingId,
    secondMappingId,
    asset
  };
}

function pendingRow(overrides: Partial<NewMappingSuggestion> = {}): NewMappingSuggestion {
  return {
    id: "suggestion-1",
    projectId: "will-be-overridden",
    scenePlanId: "will-be-overridden",
    mappingId: null,
    source: "DETERMINISTIC",
    suggestedClassification: null,
    suggestedAssetId: null,
    suggestedText: null,
    suggestedAssetTimestamp: null,
    suggestedFinalDuration: null,
    confidence: 1,
    reasoning: null,
    evidenceRefs: [{ kind: "FACT", summary: "test evidence" }],
    unresolvedReason: null,
    requiresHumanReview: false,
    conflictsWithWorkMap: false,
    ...overrides
  };
}

describe("acceptMappingSuggestion", () => {
  it("applies MAP_ASSET via the exact typed edit operation and bumps the plan revision", async () => {
    const deps = await setup();
    const suggestion = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId, suggestedAssetId: deps.asset.id }),
      NOW
    );

    const result = await acceptMappingSuggestion(deps, deps.project.projectId, suggestion.id, 1);
    expect(result.suggestion.status).toBe("ACCEPTED");
    expect(result.executionPlan.plan.revision).toBe(2);
    expect(result.executionPlan.plan.scenePlans[0]?.mappings[0]?.selectedAssetId).toBe(deps.asset.id);
  });

  it("a suggestion alone never mutates the plan - only accept does", async () => {
    const deps = await setup();
    await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId, suggestedAssetId: deps.asset.id }),
      NOW
    );
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    expect(plan?.revision).toBe(1);
    expect(plan?.scenePlans[0]?.mappings[0]?.selectedAssetId).toBeNull();
  });

  it("rejects with the SAME stale-revision error as a manual edit when baseRevision is stale", async () => {
    const deps = await setup();
    const suggestion = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId, suggestedText: "Hello" }),
      NOW
    );
    await expect(acceptMappingSuggestion(deps, deps.project.projectId, suggestion.id, 999)).rejects.toThrow(StaleExecutionPlanRevisionError);
  });

  it("refuses to accept an asset that was deleted after the suggestion was generated - re-validated at accept time", async () => {
    const deps = await setup();
    await deps.assetRepository.delete(deps.asset.id);
    const suggestion = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId, suggestedAssetId: deps.asset.id }),
      NOW
    );
    await expect(acceptMappingSuggestion(deps, deps.project.projectId, suggestion.id, 1)).rejects.toThrow(SuggestedAssetInvalidError);
  });

  it("refuses to accept an asset belonging to a different project", async () => {
    const deps = await setup();
    const otherAsset = await uploadAsset(
      { assetRepository: deps.assetRepository, assetStorage: deps.assetStorage, projectRepository: deps.projectRepository, maxUploadBytes: 1000, now: fixedNow },
      deps.other.projectId,
      { originalFilename: "other.png", mimeType: "image/png", buffer: Buffer.from("x"), requestedMediaKind: null }
    );
    const suggestion = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId, suggestedAssetId: otherAsset.id }),
      NOW
    );
    await expect(acceptMappingSuggestion(deps, deps.project.projectId, suggestion.id, 1)).rejects.toThrow(SuggestedAssetInvalidError);
  });

  it("refuses to accept a suggestion that is already ACCEPTED/REJECTED", async () => {
    const deps = await setup();
    const suggestion = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId, suggestedText: "Hello" }),
      NOW
    );
    await acceptMappingSuggestion(deps, deps.project.projectId, suggestion.id, 1);
    await expect(acceptMappingSuggestion(deps, deps.project.projectId, suggestion.id, 2)).rejects.toThrow(SuggestionNotPendingError);
  });

  it("refuses to accept a suggestion belonging to a different project - never confirms it exists elsewhere", async () => {
    const deps = await setup();
    const suggestion = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ projectId: deps.other.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId, suggestedText: "Hello" }),
      NOW
    );
    await expect(acceptMappingSuggestion(deps, deps.project.projectId, suggestion.id, 1)).rejects.toThrow(SuggestionCrossProjectAccessError);
  });

  it("throws SuggestionNotFoundError for an unknown suggestion id", async () => {
    const deps = await setup();
    await expect(acceptMappingSuggestion(deps, deps.project.projectId, "does-not-exist", 1)).rejects.toThrow(SuggestionNotFoundError);
  });

  it("accepts a suggestion with no actionable field (advisory-only) without bumping the plan revision", async () => {
    const deps = await setup();
    const suggestion = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId, suggestedClassification: "image" }),
      NOW
    );
    const result = await acceptMappingSuggestion(deps, deps.project.projectId, suggestion.id, 1);
    expect(result.suggestion.status).toBe("ACCEPTED");
    expect(result.executionPlan.plan.revision).toBe(1);
  });
});

describe("rejectMappingSuggestion", () => {
  it("marks the suggestion REJECTED and leaves the plan completely unchanged", async () => {
    const deps = await setup();
    const suggestion = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId, suggestedAssetId: deps.asset.id }),
      NOW
    );
    const result = await rejectMappingSuggestion(deps, deps.project.projectId, suggestion.id);
    expect(result.suggestion.status).toBe("REJECTED");
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    expect(plan?.revision).toBe(1);
    expect(plan?.scenePlans[0]?.mappings[0]?.selectedAssetId).toBeNull();
  });

  it("refuses to reject an already-decided suggestion", async () => {
    const deps = await setup();
    const suggestion = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId }),
      NOW
    );
    await rejectMappingSuggestion(deps, deps.project.projectId, suggestion.id);
    await expect(rejectMappingSuggestion(deps, deps.project.projectId, suggestion.id)).rejects.toThrow(SuggestionNotPendingError);
  });

  it("refuses to reject a suggestion belonging to a different project", async () => {
    const deps = await setup();
    const suggestion = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ projectId: deps.other.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId }),
      NOW
    );
    await expect(rejectMappingSuggestion(deps, deps.project.projectId, suggestion.id)).rejects.toThrow(SuggestionCrossProjectAccessError);
  });
});

describe("batchAcceptMappingSuggestions", () => {
  it("accepts several PENDING suggestions as one batched revision bump", async () => {
    const deps = await setup();
    const s1 = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ id: "s1", projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId, suggestedAssetId: deps.asset.id }),
      NOW
    );
    const s2 = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ id: "s2", projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.secondMappingId, suggestedText: "Hello" }),
      NOW
    );

    const result = await batchAcceptMappingSuggestions(deps, deps.project.projectId, [s1.id, s2.id], 1);
    expect(result.executionPlan.plan.revision).toBe(2);
    expect(result.suggestions.every((s) => s.status === "ACCEPTED")).toBe(true);
    expect(result.executionPlan.plan.scenePlans[0]?.mappings[0]?.selectedAssetId).toBe(deps.asset.id);
    expect(result.executionPlan.plan.scenePlans[0]?.mappings[1]?.text).toBe("Hello");
  });

  it("refuses the WHOLE batch (never partial) if any one suggestion is not PENDING", async () => {
    const deps = await setup();
    const s1 = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ id: "s1", projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.mappingId, suggestedAssetId: deps.asset.id }),
      NOW
    );
    const s2 = await deps.mappingSuggestionRepository.upsertPending(
      pendingRow({ id: "s2", projectId: deps.project.projectId, scenePlanId: deps.scenePlanId, mappingId: deps.secondMappingId, suggestedText: "Hello" }),
      NOW
    );
    await rejectMappingSuggestion(deps, deps.project.projectId, s2.id);

    await expect(batchAcceptMappingSuggestions(deps, deps.project.projectId, [s1.id, s2.id], 1)).rejects.toThrow(SuggestionNotPendingError);

    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    expect(plan?.revision).toBe(1);
    expect(plan?.scenePlans[0]?.mappings[0]?.selectedAssetId).toBeNull();
    const stillPending = await deps.mappingSuggestionRepository.findById(s1.id);
    expect(stillPending?.status).toBe("PENDING");
  });
});
