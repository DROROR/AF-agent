import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type AiSuggestionProposal, type TemplateManifest } from "@dyo/schemas";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { createProject } from "../../project/create-project.js";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { createExecutionPlan } from "../../execution-plan/create-execution-plan.js";
import { InMemoryAssetRepository } from "../../asset/test-support/in-memory-asset-repository.js";
import { uploadAsset } from "../../asset/upload-asset.js";
import { InMemoryAssetStorage } from "../../asset/test-support/in-memory-asset-storage.js";
import { InMemoryWorkMapRepository } from "../../work-map/test-support/in-memory-work-map-repository.js";
import { updateWorkMap } from "../../work-map/update-work-map.js";
import { InMemoryMappingSuggestionRepository } from "../test-support/in-memory-mapping-suggestion-repository.js";
import { InMemorySceneEvidenceRepository } from "../../job/test-support/in-memory-scene-evidence-repository.js";
import { generateMappingSuggestions } from "../generate-mapping-suggestions.js";
import type { AiSuggestionProvider } from "../ai-suggestion-provider.js";
import { NotConfiguredAiSuggestionProvider } from "../ai-suggestion-provider.js";
import type { MappingEvidenceBundle } from "../../../domain/mapping-evidence/types.js";

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
      { compositionId: "comp-1", name: "Scene A", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
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
          }
        ]
      }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

class StubAiProvider implements AiSuggestionProvider {
  lastBundles: MappingEvidenceBundle[] = [];
  constructor(private readonly result: unknown) {}
  isConfigured(): boolean {
    return true;
  }
  async suggest(bundles: MappingEvidenceBundle[]): Promise<unknown> {
    this.lastBundles = bundles;
    return this.result;
  }
}

function sceneEvidenceFixture(overrides: Partial<{ verifiedSourceProjectSha256: string; capturedAt: string }> = {}) {
  return {
    verifiedSourceProjectSha256: overrides.verifiedSourceProjectSha256 ?? "a".repeat(64),
    manifestCompositionId: "comp-1",
    compositionIndex: 0,
    compositionName: "Scene A",
    layers: [],
    preview: null,
    previewFailureReason: null,
    capturedAt: overrides.capturedAt ?? NOW.toISOString()
  };
}

async function setup(aiSuggestionProvider: AiSuggestionProvider = new NotConfiguredAiSuggestionProvider()) {
  const projectRepository = new InMemoryProjectRepository();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const assetRepository = new InMemoryAssetRepository();
  const assetStorage = new InMemoryAssetStorage();
  const workMapRepository = new InMemoryWorkMapRepository();
  const mappingSuggestionRepository = new InMemoryMappingSuggestionRepository();
  const sceneEvidenceRepository = new InMemorySceneEvidenceRepository();

  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifest() });
  await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);

  const deps = {
    projectRepository,
    executionPlanRepository,
    assetRepository,
    workMapRepository,
    mappingSuggestionRepository,
    sceneEvidenceRepository,
    aiSuggestionProvider,
    now: fixedNow
  };
  return { ...deps, assetStorage, project };
}

async function uploadTestAsset(deps: Awaited<ReturnType<typeof setup>>, filename = "hero.png") {
  return uploadAsset(
    { assetRepository: deps.assetRepository, assetStorage: deps.assetStorage, projectRepository: deps.projectRepository, maxUploadBytes: 1000, now: fixedNow },
    deps.project.projectId,
    { originalFilename: filename, mimeType: "image/png", buffer: Buffer.from("bytes"), requestedMediaKind: null }
  );
}

describe("generateMappingSuggestions", () => {
  it("produces a DETERMINISTIC suggestion when the Work Map explicitly names an asset for the scene", async () => {
    const deps = await setup();
    const asset = await uploadTestAsset(deps);
    await updateWorkMap({ workMapRepository: deps.workMapRepository, now: fixedNow }, deps.project.projectId, {
      baseRevision: 0,
      entries: [
        {
          sourceCompositionId: "comp-1",
          sourceReference: null,
          desiredAssetId: asset.id,
          desiredText: null,
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      ]
    });

    const result = await generateMappingSuggestions(deps, deps.project.projectId);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({ source: "DETERMINISTIC", status: "PENDING", suggestedAssetId: asset.id, confidence: 1 });
    expect(result.aiAvailable).toBe(false);
  });

  it("reports aiAvailable: false and still returns deterministic suggestions when no AI provider is configured", async () => {
    const deps = await setup();
    const result = await generateMappingSuggestions(deps, deps.project.projectId);
    expect(result.aiAvailable).toBe(false);
    expect(result.suggestions).toEqual([]); // nothing deterministic matched, no AI available either - stays unknown
  });

  it("sends only the deterministically-unmatched targets to the AI provider, and persists its valid proposals", async () => {
    const proposal: AiSuggestionProposal = {
      scenePlanId: "", // filled below once we know the real id
      mappingId: null,
      suggestedClassification: null,
      suggestedAssetId: null,
      suggestedText: "AI-suggested text",
      suggestedAssetTimestamp: null,
      suggestedFinalDuration: null,
      confidence: 0.6,
      reasoning: "inferred from context",
      evidenceRefs: [{ kind: "AI_INFERENCE", summary: "no strong signal, low-confidence guess" }]
    };

    const plain = await setup();
    const existingPlan = await plain.executionPlanRepository.findCurrentByProjectId(plain.project.projectId);
    const scenePlanId = existingPlan!.scenePlans[0]!.id;
    const mappingId = existingPlan!.scenePlans[0]!.mappings[0]!.id;

    const deps = await setup(new StubAiProvider([{ ...proposal, scenePlanId, mappingId }]));
    const result = await generateMappingSuggestions(deps, deps.project.projectId);

    expect(result.aiAvailable).toBe(true);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({ source: "AI", suggestedText: "AI-suggested text", requiresHumanReview: true });
  });

  it("never persists an AI-proposed asset id that is not a real asset in this project - discarded, not trusted", async () => {
    const plain = await setup();
    const existingPlan = await plain.executionPlanRepository.findCurrentByProjectId(plain.project.projectId);
    const scenePlanId = existingPlan!.scenePlans[0]!.id;
    const mappingId = existingPlan!.scenePlans[0]!.mappings[0]!.id;

    const proposal: AiSuggestionProposal = {
      scenePlanId,
      mappingId,
      suggestedClassification: null,
      suggestedAssetId: "arbitrary-nonexistent-asset-id",
      suggestedText: null,
      suggestedAssetTimestamp: null,
      suggestedFinalDuration: null,
      confidence: 0.9,
      reasoning: "hallucinated",
      evidenceRefs: [{ kind: "AI_INFERENCE", summary: "guessed" }]
    };

    const deps = await setup(new StubAiProvider([proposal]));
    const result = await generateMappingSuggestions(deps, deps.project.projectId);

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.suggestedAssetId).toBeNull();
    expect(result.suggestions[0]?.unresolvedReason).not.toBeNull();
  });

  it("discards a malformed AI provider response entirely - never partially trusted", async () => {
    const deps = await setup(new StubAiProvider([{ nonsense: true }]));
    const result = await generateMappingSuggestions(deps, deps.project.projectId);
    expect(result.suggestions).toEqual([]);
  });

  it("ignores an AI proposal for a target that was never asked about - never persisted against an unrelated scene/mapping", async () => {
    const proposal: AiSuggestionProposal = {
      scenePlanId: "some-other-scene-entirely",
      mappingId: "some-other-mapping-entirely",
      suggestedClassification: null,
      suggestedAssetId: null,
      suggestedText: "should never be saved",
      suggestedAssetTimestamp: null,
      suggestedFinalDuration: null,
      confidence: 0.9,
      reasoning: null,
      evidenceRefs: [{ kind: "AI_INFERENCE", summary: "made up" }]
    };
    const deps = await setup(new StubAiProvider([proposal]));
    const result = await generateMappingSuggestions(deps, deps.project.projectId);
    expect(result.suggestions).toEqual([]);
  });

  it("replaces the prior PENDING suggestion for the same target on regeneration, rather than accumulating duplicates", async () => {
    const deps = await setup();
    const asset = await uploadTestAsset(deps);
    await updateWorkMap({ workMapRepository: deps.workMapRepository, now: fixedNow }, deps.project.projectId, {
      baseRevision: 0,
      entries: [
        {
          sourceCompositionId: "comp-1",
          sourceReference: null,
          desiredAssetId: asset.id,
          desiredText: "first",
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      ]
    });
    const first = await generateMappingSuggestions(deps, deps.project.projectId);

    await updateWorkMap({ workMapRepository: deps.workMapRepository, now: fixedNow }, deps.project.projectId, {
      baseRevision: 1,
      entries: [
        {
          id: (await deps.workMapRepository.findCurrentByProjectId(deps.project.projectId))!.entries[0]!.id,
          sourceCompositionId: "comp-1",
          sourceReference: null,
          desiredAssetId: asset.id,
          desiredText: "second",
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      ]
    });
    const second = await generateMappingSuggestions(deps, deps.project.projectId);

    expect(second.suggestions).toHaveLength(1);
    expect(second.suggestions[0]?.suggestedText).toBe("second");
    expect(second.suggestions[0]?.id).not.toBe(first.suggestions[0]?.id);
  });

  it("passes persisted scene evidence to the AI provider as FACT input, and reports the scene AVAILABLE, when it matches the plan's current source SHA", async () => {
    const provider = new StubAiProvider({ proposals: [] });
    const deps = await setup(provider);
    await deps.sceneEvidenceRepository.record(
      {
        id: "evidence-1",
        projectId: deps.project.projectId,
        jobId: "job-1",
        manifestCompositionId: "comp-1",
        sourceProjectSha256: "a".repeat(64), // matches manifest()'s sourceProject.sha256
        response: sceneEvidenceFixture(),
        capturedAt: NOW
      },
      NOW
    );

    const result = await generateMappingSuggestions(deps, deps.project.projectId);

    expect(provider.lastBundles).toHaveLength(1);
    expect(provider.lastBundles[0]?.sceneEvidence).not.toBeNull();
    expect(provider.lastBundles[0]?.sceneEvidence?.manifestCompositionId).toBe("comp-1");
    expect(result.sceneEvidenceAvailability["comp-1"]).toBe("AVAILABLE");
  });

  it("never treats evidence captured against a different source SHA as current fact, and reports the scene STALE", async () => {
    const provider = new StubAiProvider({ proposals: [] });
    const deps = await setup(provider);
    await deps.sceneEvidenceRepository.record(
      {
        id: "evidence-stale",
        projectId: deps.project.projectId,
        jobId: "job-1",
        manifestCompositionId: "comp-1",
        sourceProjectSha256: "b".repeat(64), // does NOT match manifest()'s sha256 - a different .aep revision
        response: sceneEvidenceFixture({ verifiedSourceProjectSha256: "b".repeat(64) }),
        capturedAt: NOW
      },
      NOW
    );

    const result = await generateMappingSuggestions(deps, deps.project.projectId);

    expect(provider.lastBundles[0]?.sceneEvidence).toBeNull();
    expect(result.sceneEvidenceAvailability["comp-1"]).toBe("STALE");
  });

  it("reports a scene NOT_INSPECTED when no scene evidence has ever been captured for it", async () => {
    const deps = await setup();
    const result = await generateMappingSuggestions(deps, deps.project.projectId);
    expect(result.sceneEvidenceAvailability["comp-1"]).toBe("NOT_INSPECTED");
  });
});
