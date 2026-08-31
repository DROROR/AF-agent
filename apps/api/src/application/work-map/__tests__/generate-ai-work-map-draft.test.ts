import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { createProject } from "../../project/create-project.js";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { InMemoryAssetRepository } from "../../asset/test-support/in-memory-asset-repository.js";
import { uploadAsset } from "../../asset/upload-asset.js";
import { InMemoryAssetStorage } from "../../asset/test-support/in-memory-asset-storage.js";
import { InMemoryWorkMapRepository } from "../test-support/in-memory-work-map-repository.js";
import { InMemorySceneEvidenceRepository } from "../../job/test-support/in-memory-scene-evidence-repository.js";
import { generateAiWorkMapDraft } from "../generate-ai-work-map-draft.js";
import { WorkMapDraftNotConfiguredError, type AiWorkMapDraftInput, type AiWorkMapDraftResult, type AiWorkMapMetadata, type AiWorkMapProvider } from "../ai-work-map-provider.js";
import { AiWorkMapNotConfiguredError, NoUsableWorkMapDraftError } from "../../../errors/app-error.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const fixedNow = () => NOW;

const DEFAULT_METADATA: AiWorkMapMetadata = { stopReason: "tool_use", inputTokens: 100, outputTokens: 50 };

function manifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW.toISOString(),
    compositions: [
      { compositionId: "comp-login", aeProjectItemIndex: 1, name: "Login Screen", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] },
      { compositionId: "comp-checkout", aeProjectItemIndex: 2, name: "Checkout", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
    ],
    scenes: [
      { sceneId: "scene-login", displayName: null, compositionId: "comp-login", originalOrderIndex: 0, startTimeSeconds: 0, durationSeconds: 5, placeholders: [] },
      { sceneId: "scene-checkout", displayName: null, compositionId: "comp-checkout", originalOrderIndex: 1, startTimeSeconds: 0, durationSeconds: 5, placeholders: [] }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

class StubAiWorkMapProvider implements AiWorkMapProvider {
  lastInput: AiWorkMapDraftInput | null = null;
  constructor(
    private readonly rawEntries: unknown,
    private readonly metadata: AiSuggestionMetadataAlias = DEFAULT_METADATA
  ) {}
  isConfigured(): boolean {
    return true;
  }
  async draftWorkMap(input: AiWorkMapDraftInput): Promise<AiWorkMapDraftResult> {
    this.lastInput = input;
    return { entries: this.rawEntries, metadata: this.metadata };
  }
}
type AiSuggestionMetadataAlias = AiWorkMapMetadata;

async function setup(aiWorkMapProvider: AiWorkMapProvider, manifestOverride: TemplateManifest = manifest()) {
  const projectRepository = new InMemoryProjectRepository();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const assetRepository = new InMemoryAssetRepository();
  const assetStorage = new InMemoryAssetStorage();
  const workMapRepository = new InMemoryWorkMapRepository();
  const sceneEvidenceRepository = new InMemorySceneEvidenceRepository();

  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifestOverride });

  const deps = {
    projectRepository,
    executionPlanRepository,
    assetRepository,
    workMapRepository,
    sceneEvidenceRepository,
    aiWorkMapProvider,
    now: fixedNow
  };
  return { ...deps, assetStorage, project };
}

async function uploadTestAsset(deps: Awaited<ReturnType<typeof setup>>, filename = "login-demo.mp4") {
  return uploadAsset(
    { assetRepository: deps.assetRepository, assetStorage: deps.assetStorage, projectRepository: deps.projectRepository, maxUploadBytes: 10_000_000, now: fixedNow },
    deps.project.projectId,
    { originalFilename: filename, mimeType: "video/mp4", buffer: Buffer.from("bytes"), requestedMediaKind: null }
  );
}

describe("generateAiWorkMapDraft - AI-first Work Map (video-planning UX simplification, 2026-08-31)", () => {
  it("persists a real Work Map revision from the AI's valid entries - never touches the execution plan", async () => {
    const deps = await setup(
      new StubAiWorkMapProvider({
        entries: [
          { sourceCompositionId: "comp-login", sourceReference: "Login", desiredAssetId: null, desiredText: null, assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null },
          { sourceCompositionId: "comp-checkout", sourceReference: "Checkout", desiredAssetId: null, desiredText: "Buy Easily", assetTimestampSeconds: null, desiredDurationSeconds: 4, instructions: null }
        ]
      })
    );

    const workMap = await generateAiWorkMapDraft(deps, deps.project.projectId, "Use the login screen first, then checkout.");

    expect(workMap.entries).toHaveLength(2);
    expect(workMap.revision).toBe(1);
    expect(await deps.executionPlanRepository.findCurrentByProjectId(deps.project.projectId)).toBeNull();
  });

  it("passes real project context (compositions, real assets, instructions) to the provider - never a raw prompt string built ad hoc", async () => {
    const provider = new StubAiWorkMapProvider({ entries: [{ sourceCompositionId: "comp-login", sourceReference: null, desiredAssetId: null, desiredText: null, assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null }] });
    const deps = await setup(provider);
    const asset = await uploadTestAsset(deps);

    await generateAiWorkMapDraft(deps, deps.project.projectId, "Use the login recording.");

    expect(provider.lastInput?.instructions).toBe("Use the login recording.");
    expect(provider.lastInput?.compositions).toEqual([
      { id: "comp-login", name: "Login Screen" },
      { id: "comp-checkout", name: "Checkout" }
    ]);
    expect(provider.lastInput?.candidateAssets).toEqual([{ id: asset.id, originalFilename: "login-demo.mp4", label: null, mediaKind: "VIDEO" }]);
  });

  it("one invalid raw entry rejects only itself - a real 3-entry draft with 1 malformed entry still persists the other 2", async () => {
    const deps = await setup(
      new StubAiWorkMapProvider({
        entries: [
          { sourceCompositionId: "comp-login", sourceReference: null, desiredAssetId: null, desiredText: null, assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null },
          { nonsense: true },
          { sourceCompositionId: "comp-checkout", sourceReference: null, desiredAssetId: null, desiredText: null, assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null }
        ]
      })
    );

    const workMap = await generateAiWorkMapDraft(deps, deps.project.projectId, "Use the login screen, then checkout.");

    expect(workMap.entries).toHaveLength(2);
  });

  it("a real attempt that produces zero usable entries throws a typed error rather than silently persisting an empty Work Map", async () => {
    const deps = await setup(new StubAiWorkMapProvider({ entries: [{ nonsense: true }] }));

    await expect(generateAiWorkMapDraft(deps, deps.project.projectId, "??")).rejects.toThrow(NoUsableWorkMapDraftError);
  });

  it("a provider that validly returns zero entries also throws the same typed error - a real 'tell AI what you want' click should never silently do nothing", async () => {
    const deps = await setup(new StubAiWorkMapProvider({ entries: [] }));

    await expect(generateAiWorkMapDraft(deps, deps.project.projectId, "??")).rejects.toThrow(NoUsableWorkMapDraftError);
  });

  it("refuses with a typed, actionable error when no AI provider is configured - never a silent no-op", async () => {
    const deps = await setup({
      isConfigured: () => false,
      draftWorkMap: async () => {
        throw new WorkMapDraftNotConfiguredError();
      }
    });

    await expect(generateAiWorkMapDraft(deps, deps.project.projectId, "Use the login screen.")).rejects.toThrow(AiWorkMapNotConfiguredError);
  });

  it("uses the existing Work Map as context when regenerating, and replaces it as a new revision - same replace-whole-list semantics as a manual save", async () => {
    const provider = new StubAiWorkMapProvider({
      entries: [{ sourceCompositionId: "comp-login", sourceReference: "Updated", desiredAssetId: null, desiredText: null, assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null }]
    });
    const deps = await setup(provider);

    const first = await generateAiWorkMapDraft(deps, deps.project.projectId, "Use the login screen.");
    expect(first.revision).toBe(1);

    const second = await generateAiWorkMapDraft(deps, deps.project.projectId, "Actually, use checkout too.");
    expect(second.revision).toBe(2);
    expect(provider.lastInput?.existingEntries).toHaveLength(1);
    expect(provider.lastInput?.existingEntries[0]?.sourceReference).toBe("Updated");
  });
});
