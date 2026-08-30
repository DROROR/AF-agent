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
import {
  AI_MAPPING_BATCH_CONCURRENCY,
  AI_MAPPING_BATCH_SIZE,
  generateMappingSuggestions,
  type MappingSuggestionsFunnelLogger
} from "../generate-mapping-suggestions.js";
import type { AiSuggestionMetadata, AiSuggestionProvider, AiSuggestionResult } from "../ai-suggestion-provider.js";
import { NotConfiguredAiSuggestionProvider } from "../ai-suggestion-provider.js";
import type { MappingEvidenceBundle } from "../../../domain/mapping-evidence/types.js";
import { AiMappingBatchTruncatedError, NoUsableMappingSuggestionsError } from "../../../errors/app-error.js";

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
          }
        ]
      }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

const DEFAULT_STUB_METADATA: AiSuggestionMetadata = { stopReason: "tool_use", inputTokens: 500, outputTokens: 250 };

class StubAiProvider implements AiSuggestionProvider {
  lastBundles: MappingEvidenceBundle[] = [];
  constructor(
    private readonly result: unknown,
    private readonly metadata: AiSuggestionMetadata = DEFAULT_STUB_METADATA
  ) {}
  isConfigured(): boolean {
    return true;
  }
  async suggest(bundles: MappingEvidenceBundle[]): Promise<AiSuggestionResult> {
    this.lastBundles = bundles;
    return { proposals: this.result, metadata: this.metadata };
  }
}

function sceneEvidenceFixture(overrides: Partial<{ verifiedSourceProjectSha256: string; capturedAt: string }> = {}) {
  return {
    verifiedSourceProjectSha256: overrides.verifiedSourceProjectSha256 ?? "a".repeat(64),
    manifestCompositionId: "comp-1",
    aeProjectItemIndex: 1,
    compositionName: "Scene A",
    layers: [],
    preview: null,
    previewFailureReason: null,
    capturedAt: overrides.capturedAt ?? NOW.toISOString()
  };
}

/** Real production bug, 2026-08-30: a real Anthropic batch must be able to carry many independent unresolved targets in one composition - one scene with N placeholders produces N real mappings within one scenePlan (see build-execution-plan.ts's buildScenePlans). */
function manifestWithPlaceholders(count: number): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-multi",
    templateName: "tmpl-multi",
    sourceProject: { path: "/copies/test-multi.aep", name: "test-multi.aep", sha256: "b".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW.toISOString(),
    compositions: [
      { compositionId: "comp-multi", aeProjectItemIndex: 1, name: "Scene Multi", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
    ],
    scenes: [
      {
        sceneId: "scene-multi",
        displayName: null,
        compositionId: "comp-multi",
        originalOrderIndex: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
        placeholders: Array.from({ length: count }, (_, i) => ({
          placeholderId: `ph-${i}`,
          displayLabel: null,
          compositionId: "comp-multi",
          layerName: `Layer ${i}`,
          layerIndex: i + 1,
          layerPath: [],
          placeholderType: "image" as const,
          editable: true,
          sourceType: "AVLayer" as const,
          dimensions: null,
          startTimeSeconds: 0,
          durationSeconds: 5,
          evidence: { source: "read_directly" as const, reason: "AVLayer confirmed via ae_get_composition" }
        }))
      }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

/** A composition with zero placeholders still gets exactly one scene-level bundle (mappingId: null) - see build-evidence-bundles.ts's own doc comment. To get genuinely ZERO eligible targets, the manifest must have zero scenes/compositions at all. */
function manifestWithNoScenes(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-empty",
    templateName: "tmpl-empty",
    sourceProject: { path: "/copies/test-empty.aep", name: "test-empty.aep", sha256: "c".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW.toISOString(),
    compositions: [],
    scenes: [],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

async function setup(aiSuggestionProvider: AiSuggestionProvider = new NotConfiguredAiSuggestionProvider(), manifestOverride: TemplateManifest = manifest()) {
  const projectRepository = new InMemoryProjectRepository();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const assetRepository = new InMemoryAssetRepository();
  const assetStorage = new InMemoryAssetStorage();
  const workMapRepository = new InMemoryWorkMapRepository();
  const mappingSuggestionRepository = new InMemoryMappingSuggestionRepository();
  const sceneEvidenceRepository = new InMemorySceneEvidenceRepository();

  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifestOverride });
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

  it("rejects a malformed AI provider response with a typed error rather than a silent empty 200 success - real production bug, 2026-08-30", async () => {
    const deps = await setup(new StubAiProvider([{ nonsense: true }]));
    await expect(generateMappingSuggestions(deps, deps.project.projectId)).rejects.toThrow(NoUsableMappingSuggestionsError);
    // Never partially trusted, and never persisted either.
    expect(await deps.mappingSuggestionRepository.listByProjectId(deps.project.projectId)).toEqual([]);
  });

  it("rejects with a typed error (never a silent empty 200) when the only AI proposal targets something this call never asked about", async () => {
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
    await expect(generateMappingSuggestions(deps, deps.project.projectId)).rejects.toThrow(NoUsableMappingSuggestionsError);
    expect(await deps.mappingSuggestionRepository.listByProjectId(deps.project.projectId)).toEqual([]);
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
    const deps = await setup();
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    const scenePlanId = plan!.scenePlans[0]!.id;
    const mappingId = plan!.scenePlans[0]!.mappings[0]!.id;
    // A real, valid proposal for the one eligible target - AI validly
    // returning zero proposals would now throw NoUsableMappingSuggestionsError
    // (see section 7's rule), which is not what this test is about.
    const provider = new StubAiProvider([baseProposal({ scenePlanId, mappingId })]);
    deps.aiSuggestionProvider = provider;
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
    const deps = await setup();
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    const scenePlanId = plan!.scenePlans[0]!.id;
    const mappingId = plan!.scenePlans[0]!.mappings[0]!.id;
    const provider = new StubAiProvider([baseProposal({ scenePlanId, mappingId })]);
    deps.aiSuggestionProvider = provider;
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

class CapturingLogger implements MappingSuggestionsFunnelLogger {
  calls: Array<{ payload: Record<string, unknown>; message: string }> = [];
  info(payload: Record<string, unknown>, message: string): void {
    this.calls.push({ payload, message });
  }
  funnelCall(): { payload: Record<string, unknown>; message: string } | undefined {
    return this.calls.find((call) => call.message === "mapping-suggestions generate: AI proposal funnel");
  }
  batchCalls(): Array<{ payload: Record<string, unknown>; message: string }> {
    return this.calls.filter((call) => call.message === "mapping-suggestions generate: AI batch");
  }
}

function baseProposal(overrides: Partial<AiSuggestionProposal> & Pick<AiSuggestionProposal, "scenePlanId" | "mappingId">): AiSuggestionProposal {
  return {
    suggestedClassification: null,
    suggestedAssetId: null,
    suggestedText: "a real suggestion",
    suggestedAssetTimestamp: null,
    suggestedFinalDuration: null,
    confidence: 0.6,
    reasoning: "a real reason",
    evidenceRefs: [{ kind: "AI_INFERENCE", summary: "no strong signal, low-confidence guess" }],
    ...overrides
  };
}

/**
 * Real production bug, 2026-08-30: aiSuggestionProposalBatchSchema used to
 * validate the ENTIRE proposals array in one Zod parse - a single
 * malformed proposal (out-of-range confidence, a non-positive duration, a
 * negative timestamp, an empty required id, a reference to an unknown
 * target) silently discarded the whole batch, including every otherwise-
 * valid sibling, with zero logging, while the route still returned 200.
 * These tests prove each proposal is now validated INDEPENDENTLY, that a
 * real batch with nothing usable now surfaces a typed error instead of a
 * silent empty success, and that the funnel is now observable. Each test
 * uses one `setup()` call and reads the plan's own real mapping ids back
 * from that SAME setup, rather than cross-wiring two separate projects.
 */
describe("generateMappingSuggestions - item-level validation, typed failure, and funnel observability (real production bug, 2026-08-30)", () => {
  it("10 valid + 1 invalid proposal => the 10 valid ones survive, the 1 invalid one does not take them down with it", async () => {
    const deps = await setup(new NotConfiguredAiSuggestionProvider(), manifestWithPlaceholders(11));
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    const scenePlanId = plan!.scenePlans[0]!.id;
    const mappingIds = plan!.scenePlans[0]!.mappings.map((mapping) => mapping.id);
    expect(mappingIds).toHaveLength(11);

    const validProposals = mappingIds.slice(0, 10).map((mappingId) => baseProposal({ scenePlanId, mappingId }));
    const invalidProposal = baseProposal({ scenePlanId, mappingId: mappingIds[10]!, confidence: 1.5 });
    deps.aiSuggestionProvider = new StubAiProvider([...validProposals, invalidProposal]);

    const result = await generateMappingSuggestions(deps, deps.project.projectId);

    expect(result.suggestions).toHaveLength(10);
    expect(result.suggestions.every((suggestion) => suggestion.source === "AI")).toBe(true);
  });

  it("out-of-range confidence rejects only that one proposal", async () => {
    const deps = await setup(new NotConfiguredAiSuggestionProvider(), manifestWithPlaceholders(2));
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    const scenePlanId = plan!.scenePlans[0]!.id;
    const [validMappingId, invalidMappingId] = plan!.scenePlans[0]!.mappings.map((mapping) => mapping.id);
    deps.aiSuggestionProvider = new StubAiProvider([
      baseProposal({ scenePlanId, mappingId: validMappingId! }),
      baseProposal({ scenePlanId, mappingId: invalidMappingId!, confidence: 1.5 })
    ]);

    const result = await generateMappingSuggestions(deps, deps.project.projectId);

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.mappingId).toBe(validMappingId);
  });

  it("a non-positive suggestedFinalDuration rejects only that one proposal", async () => {
    const deps = await setup(new NotConfiguredAiSuggestionProvider(), manifestWithPlaceholders(2));
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    const scenePlanId = plan!.scenePlans[0]!.id;
    const [validMappingId, invalidMappingId] = plan!.scenePlans[0]!.mappings.map((mapping) => mapping.id);
    deps.aiSuggestionProvider = new StubAiProvider([
      baseProposal({ scenePlanId, mappingId: validMappingId! }),
      baseProposal({ scenePlanId, mappingId: invalidMappingId!, suggestedFinalDuration: 0 })
    ]);

    const result = await generateMappingSuggestions(deps, deps.project.projectId);

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.mappingId).toBe(validMappingId);
  });

  it("a negative suggestedAssetTimestamp rejects only that one proposal", async () => {
    const deps = await setup(new NotConfiguredAiSuggestionProvider(), manifestWithPlaceholders(2));
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    const scenePlanId = plan!.scenePlans[0]!.id;
    const [validMappingId, invalidMappingId] = plan!.scenePlans[0]!.mappings.map((mapping) => mapping.id);
    deps.aiSuggestionProvider = new StubAiProvider([
      baseProposal({ scenePlanId, mappingId: validMappingId! }),
      baseProposal({ scenePlanId, mappingId: invalidMappingId!, suggestedAssetTimestamp: -5 })
    ]);

    const result = await generateMappingSuggestions(deps, deps.project.projectId);

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.mappingId).toBe(validMappingId);
  });

  it("an empty (non-null) required string - reasoning - rejects only that one proposal, never coerced to null or repaired", async () => {
    const deps = await setup(new NotConfiguredAiSuggestionProvider(), manifestWithPlaceholders(2));
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    const scenePlanId = plan!.scenePlans[0]!.id;
    const [validMappingId, invalidMappingId] = plan!.scenePlans[0]!.mappings.map((mapping) => mapping.id);
    deps.aiSuggestionProvider = new StubAiProvider([
      baseProposal({ scenePlanId, mappingId: validMappingId! }),
      baseProposal({ scenePlanId, mappingId: invalidMappingId!, reasoning: "" })
    ]);

    const result = await generateMappingSuggestions(deps, deps.project.projectId);

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.mappingId).toBe(validMappingId);
  });

  it("an invalid project reference (unknown scenePlanId/mappingId) rejects only that one proposal, alongside a valid sibling that survives", async () => {
    const deps = await setup(new NotConfiguredAiSuggestionProvider(), manifestWithPlaceholders(2));
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    const scenePlanId = plan!.scenePlans[0]!.id;
    const [validMappingId] = plan!.scenePlans[0]!.mappings.map((mapping) => mapping.id);
    deps.aiSuggestionProvider = new StubAiProvider([
      baseProposal({ scenePlanId, mappingId: validMappingId! }),
      baseProposal({ scenePlanId: "unknown-scene-entirely", mappingId: "unknown-mapping-entirely" })
    ]);

    const result = await generateMappingSuggestions(deps, deps.project.projectId);

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.mappingId).toBe(validMappingId);
  });

  it("logs a structured funnel record with accurate counts - eligible targets, raw/domain/reference counts, and the real persisted count", async () => {
    const deps = await setup(new NotConfiguredAiSuggestionProvider(), manifestWithPlaceholders(3));
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    const scenePlanId = plan!.scenePlans[0]!.id;
    const mappingIds = plan!.scenePlans[0]!.mappings.map((mapping) => mapping.id);
    const validMappingId = mappingIds[0];
    const domainInvalidTarget = mappingIds[2];
    deps.aiSuggestionProvider = new StubAiProvider([
      baseProposal({ scenePlanId, mappingId: validMappingId! }),
      baseProposal({ scenePlanId: "unknown-scene", mappingId: "unknown-mapping" }),
      baseProposal({ scenePlanId, mappingId: domainInvalidTarget!, confidence: 42 })
    ]);
    const logger = new CapturingLogger();

    await generateMappingSuggestions({ ...deps, log: logger }, deps.project.projectId);

    const funnel = logger.funnelCall();
    expect(funnel).toBeDefined();
    expect(funnel!.payload).toMatchObject({
      eligibleTargetCount: 3,
      deterministicProposalCount: 0,
      batchSize: 20,
      batchCount: 1,
      batchConcurrency: 2,
      rawProposalCount: 3,
      domainValidProposalCount: 2,
      domainRejectedProposalCount: 1,
      referenceValidProposalCount: 1,
      referenceRejectedProposalCount: 1,
      finalPersistableCount: 1,
      persistedCount: 1
    });
    // Never the raw proposal content/reasoning/text - counts and issue path/code only.
    expect(JSON.stringify(funnel!.payload)).not.toContain("a real suggestion");
    expect(JSON.stringify(funnel!.payload)).not.toContain("a real reason");

    // Per-batch log also carries the real stop_reason/token counts for this one batch.
    const [batchLog] = logger.batchCalls();
    expect(batchLog!.payload).toMatchObject({
      batchIndex: 0,
      targetCount: 3,
      providerStopReason: DEFAULT_STUB_METADATA.stopReason,
      providerInputTokens: DEFAULT_STUB_METADATA.inputTokens,
      providerOutputTokens: DEFAULT_STUB_METADATA.outputTokens,
      rawProposalCount: 3
    });
  });

  it("real production bug, 2026-08-30, now caught at the source: a batch reporting stop_reason max_tokens throws a typed truncation error instead of silently completing with zero proposals - the per-batch log still records the real stop_reason/token counts internally", async () => {
    const deps = await setup(new NotConfiguredAiSuggestionProvider(), manifestWithPlaceholders(1));
    deps.aiSuggestionProvider = new StubAiProvider({ proposals: [] }, { stopReason: "max_tokens", inputTokens: 45000, outputTokens: 8000 });
    const logger = new CapturingLogger();

    await expect(generateMappingSuggestions({ ...deps, log: logger }, deps.project.projectId)).rejects.toThrow(AiMappingBatchTruncatedError);

    const [batchLog] = logger.batchCalls();
    expect(batchLog).toBeDefined();
    expect(batchLog!.payload).toMatchObject({
      batchIndex: 0,
      targetCount: 1,
      providerStopReason: "max_tokens",
      providerInputTokens: 45000,
      providerOutputTokens: 8000,
      rawProposalCount: 0
    });
    // Nothing was persisted - the whole request refused before reaching persistence.
    expect(await deps.mappingSuggestionRepository.listByProjectId(deps.project.projectId)).toEqual([]);
  });

  it("issues zero batches (and logs zero batch entries) when AI is not configured - the provider is never even called", async () => {
    const deps = await setup(new NotConfiguredAiSuggestionProvider(), manifestWithPlaceholders(1));
    const logger = new CapturingLogger();

    await generateMappingSuggestions({ ...deps, log: logger }, deps.project.projectId);

    expect(logger.batchCalls()).toEqual([]);
    const funnel = logger.funnelCall();
    expect(funnel!.payload).toMatchObject({ batchCount: 0, rawProposalCount: 0 });
  });

  it("never mutates/coerces the model's own values for a rejected proposal - it is simply absent from persistence, not repaired", async () => {
    const deps = await setup(new NotConfiguredAiSuggestionProvider(), manifestWithPlaceholders(1));
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    const scenePlanId = plan!.scenePlans[0]!.id;
    const mappingId = plan!.scenePlans[0]!.mappings[0]!.id;
    deps.aiSuggestionProvider = new StubAiProvider([baseProposal({ scenePlanId, mappingId, suggestedFinalDuration: -3 })]);

    await expect(generateMappingSuggestions(deps, deps.project.projectId)).rejects.toThrow(NoUsableMappingSuggestionsError);
    expect(await deps.mappingSuggestionRepository.listByProjectId(deps.project.projectId)).toEqual([]);
  });

  it("a real batch with nothing usable (every proposal rejected) surfaces a typed 422-mapped error, never a silent empty 200 success", async () => {
    const deps = await setup(new NotConfiguredAiSuggestionProvider(), manifestWithPlaceholders(2));
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId);
    const scenePlanId = plan!.scenePlans[0]!.id;
    const [firstMappingId, secondMappingId] = plan!.scenePlans[0]!.mappings.map((mapping) => mapping.id);
    deps.aiSuggestionProvider = new StubAiProvider([
      baseProposal({ scenePlanId, mappingId: firstMappingId!, confidence: 2 }),
      baseProposal({ scenePlanId, mappingId: secondMappingId!, suggestedFinalDuration: -1 })
    ]);

    const call = generateMappingSuggestions(deps, deps.project.projectId);
    await expect(call).rejects.toThrow(NoUsableMappingSuggestionsError);
    await expect(call.catch((error: unknown) => (error as { statusCode?: number }).statusCode)).resolves.toBe(422);
  });

  it("real production bug, 2026-08-30, rule widened by batching: a real AI attempt that completes every batch normally (no truncation) but still returns zero proposals in total now surfaces the same typed error, not a legitimate empty success - the ambiguity that used to excuse this is gone once truncation is ruled out per-batch", async () => {
    const deps = await setup(new StubAiProvider({ proposals: [] }), manifestWithPlaceholders(2));
    const call = generateMappingSuggestions(deps, deps.project.projectId);
    await expect(call).rejects.toThrow(NoUsableMappingSuggestionsError);
    expect(await deps.mappingSuggestionRepository.listByProjectId(deps.project.projectId)).toEqual([]);
  });

  it("zero eligible targets (everything resolved deterministically) remains a normal success even with a real AI provider configured - AI is never even called", async () => {
    const deps = await setup(new StubAiProvider([]));
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
    expect(result.suggestions[0]?.source).toBe("DETERMINISTIC");
  });
});

/** Tracks every real call the batching logic makes to the provider - bundles per call (for order/size assertions), and concurrent-call high-water mark (for the concurrency-bound assertion). A real (tiny) delay is used so overlapping calls genuinely overlap in test timing, rather than resolving synchronously in a way that could never reveal a concurrency bug. */
class TrackingAiProvider implements AiSuggestionProvider {
  calls: MappingEvidenceBundle[][] = [];
  activeCount = 0;
  maxActiveCount = 0;
  constructor(private readonly resultFor: (bundles: MappingEvidenceBundle[], callIndex: number) => AiSuggestionResult = () => ({ proposals: [], metadata: DEFAULT_STUB_METADATA })) {}
  isConfigured(): boolean {
    return true;
  }
  async suggest(bundles: MappingEvidenceBundle[]): Promise<AiSuggestionResult> {
    const callIndex = this.calls.length;
    this.calls.push(bundles);
    this.activeCount += 1;
    this.maxActiveCount = Math.max(this.maxActiveCount, this.activeCount);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.activeCount -= 1;
    return this.resultFor(bundles, callIndex);
  }
}

/**
 * Real production bug, 2026-08-30: one Anthropic call for 106 eligible
 * targets consumed its full 8000-token output budget (proven:
 * providerOutputTokens 8000, stop_reason "max_tokens") before completing
 * a single valid proposal. These tests prove the fix: unresolved targets
 * are split into fixed-size, order-preserving batches
 * (AI_MAPPING_BATCH_SIZE) run at bounded concurrency
 * (AI_MAPPING_BATCH_CONCURRENCY), never one unbounded request or one
 * unbounded Promise.all() over every batch.
 */
describe("generateMappingSuggestions - target batching and bounded concurrency (real production bug, 2026-08-30)", () => {
  it("AI_MAPPING_BATCH_SIZE is 20 and AI_MAPPING_BATCH_CONCURRENCY is 2 - the exact values proven safe against the real 106-target failure", () => {
    expect(AI_MAPPING_BATCH_SIZE).toBe(20);
    expect(AI_MAPPING_BATCH_CONCURRENCY).toBe(2);
  });

  it("0 eligible targets => 0 provider calls - the provider is never even invoked", async () => {
    const provider = new TrackingAiProvider();
    const deps = await setup(provider, manifestWithNoScenes());
    await generateMappingSuggestions(deps, deps.project.projectId);
    expect(provider.calls).toHaveLength(0);
  });

  it.each([
    [1, 1],
    [20, 1],
    [21, 2],
    [40, 2],
    [106, 6]
  ])("%i eligible targets => %i batch(es)", async (targetCount, expectedBatchCount) => {
    const provider = new TrackingAiProvider();
    const deps = await setup(provider, manifestWithPlaceholders(targetCount));
    // The provider validly returns zero proposals for every batch here -
    // that alone now throws (see the "rule widened by batching" test
    // above), but the batches still all ran by the time it does.
    await expect(generateMappingSuggestions(deps, deps.project.projectId)).rejects.toThrow(NoUsableMappingSuggestionsError);
    expect(provider.calls).toHaveLength(expectedBatchCount);
  });

  it("preserves original target order across batches - batch 0 gets the first 20 targets, batch 1 the next 20, and so on, never a random regrouping", async () => {
    const provider = new TrackingAiProvider();
    const deps = await setup(provider, manifestWithPlaceholders(40));
    await expect(generateMappingSuggestions(deps, deps.project.projectId)).rejects.toThrow(NoUsableMappingSuggestionsError);

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]!.map((bundle) => bundle.manifestPlaceholderId)).toEqual(Array.from({ length: 20 }, (_, i) => `ph-${i}`));
    expect(provider.calls[1]!.map((bundle) => bundle.manifestPlaceholderId)).toEqual(Array.from({ length: 20 }, (_, i) => `ph-${i + 20}`));
  });

  it("never runs more than AI_MAPPING_BATCH_CONCURRENCY provider calls at once, even with many batches in flight", async () => {
    const provider = new TrackingAiProvider();
    const deps = await setup(provider, manifestWithPlaceholders(106));
    await expect(generateMappingSuggestions(deps, deps.project.projectId)).rejects.toThrow(NoUsableMappingSuggestionsError);

    expect(provider.calls).toHaveLength(6);
    expect(provider.maxActiveCount).toBeLessThanOrEqual(AI_MAPPING_BATCH_CONCURRENCY);
    expect(provider.maxActiveCount).toBe(AI_MAPPING_BATCH_CONCURRENCY); // real concurrency was actually exercised, not accidentally serialized
  });

  it("merges valid proposals from every successful batch - a 21-target request (2 batches) persists suggestions sourced from both", async () => {
    const provider = new TrackingAiProvider((bundles) => ({
      proposals: bundles.map((bundle) => baseProposal({ scenePlanId: bundle.scenePlanId, mappingId: bundle.mappingId })),
      metadata: DEFAULT_STUB_METADATA
    }));
    const deps = await setup(provider, manifestWithPlaceholders(21));

    const result = await generateMappingSuggestions(deps, deps.project.projectId);

    expect(provider.calls).toHaveLength(2);
    expect(result.suggestions).toHaveLength(21);
    expect(result.suggestions.every((suggestion) => suggestion.source === "AI")).toBe(true);
  });

  it("one invalid proposal in a merged multi-batch result rejects only itself - siblings from the same and other batches all survive", async () => {
    const provider = new TrackingAiProvider((bundles, callIndex) =>
      callIndex === 0
        ? {
            proposals: [
              ...bundles.slice(0, -1).map((bundle) => baseProposal({ scenePlanId: bundle.scenePlanId, mappingId: bundle.mappingId })),
              baseProposal({ scenePlanId: bundles[bundles.length - 1]!.scenePlanId, mappingId: bundles[bundles.length - 1]!.mappingId, confidence: 1.5 })
            ],
            metadata: DEFAULT_STUB_METADATA
          }
        : { proposals: bundles.map((bundle) => baseProposal({ scenePlanId: bundle.scenePlanId, mappingId: bundle.mappingId })), metadata: DEFAULT_STUB_METADATA }
    );
    const deps = await setup(provider, manifestWithPlaceholders(21));

    const result = await generateMappingSuggestions(deps, deps.project.projectId);

    // 20 in batch 0 (19 valid + 1 invalid) + 1 in batch 1 (valid) = 20 persisted.
    expect(result.suggestions).toHaveLength(20);
  });

  it("one provider batch throwing aborts the whole request - no suggestions from any batch (including already-successful ones) are persisted", async () => {
    const provider = new TrackingAiProvider((bundles, callIndex) => {
      if (callIndex === 1) {
        throw new Error("simulated real provider failure on the second batch");
      }
      return { proposals: bundles.map((bundle) => baseProposal({ scenePlanId: bundle.scenePlanId, mappingId: bundle.mappingId })), metadata: DEFAULT_STUB_METADATA };
    });
    const deps = await setup(provider, manifestWithPlaceholders(40));

    await expect(generateMappingSuggestions(deps, deps.project.projectId)).rejects.toThrow("simulated real provider failure on the second batch");
    expect(await deps.mappingSuggestionRepository.listByProjectId(deps.project.projectId)).toEqual([]);
  });

  it("funnel totals equal the sum of per-batch counts across all batches", async () => {
    const provider = new TrackingAiProvider((bundles, callIndex) => ({
      // Batch 0: all valid. Batch 1: all valid except the first one has an out-of-range confidence.
      proposals: bundles.map((bundle, i) =>
        baseProposal({ scenePlanId: bundle.scenePlanId, mappingId: bundle.mappingId, ...(callIndex === 1 && i === 0 ? { confidence: 9 } : {}) })
      ),
      metadata: DEFAULT_STUB_METADATA
    }));
    const deps = await setup(provider, manifestWithPlaceholders(40));
    const logger = new CapturingLogger();

    await generateMappingSuggestions({ ...deps, log: logger }, deps.project.projectId);

    const batchLogs = logger.batchCalls();
    expect(batchLogs).toHaveLength(2);
    const sumRawFromBatches = batchLogs.reduce((total, call) => total + (call.payload.rawProposalCount as number), 0);

    const funnel = logger.funnelCall();
    expect(funnel!.payload.rawProposalCount).toBe(sumRawFromBatches);
    expect(funnel!.payload).toMatchObject({
      batchCount: 2,
      rawProposalCount: 40,
      domainValidProposalCount: 39,
      domainRejectedProposalCount: 1,
      referenceValidProposalCount: 39,
      finalPersistableCount: 39,
      persistedCount: 39
    });
  });
});
