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
import { buildAiSummary, compositionsWorthPlanning, generateAiWorkMapDraft, reconcileTargetPlaceholder } from "../generate-ai-work-map-draft.js";
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
      { id: "comp-login", name: "Login Screen", editableLayers: [] },
      { id: "comp-checkout", name: "Checkout", editableLayers: [] }
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

describe("compositionsWorthPlanning - which compositions the AI is asked to plan (real failure 2026-10-02)", () => {
  type Placeholder = TemplateManifest["scenes"][number]["placeholders"][number];
  type Composition = TemplateManifest["compositions"][number];

  function composition(compositionId: string, name: string, nested: boolean): Composition {
    return { compositionId, aeProjectItemIndex: 1, name, widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: nested, parentCompositionIds: [] };
  }

  function placeholder(compositionId: string, layerName: string, placeholderType: Placeholder["placeholderType"]): Placeholder {
    return { placeholderId: `${compositionId}-${layerName}`, displayLabel: null, compositionId, layerName, layerIndex: 1, layerPath: [], placeholderType, editable: true, sourceType: null, dimensions: null, startTimeSeconds: 0, durationSeconds: 5, evidence: { source: "read_directly", reason: "test fixture" } };
  }

  /** One master composition, everything else nested inside it - the shape that broke. */
  function singleMasterManifest(): TemplateManifest {
    const base = manifest();
    return {
      ...base,
      compositions: [
        composition("comp-master", "Master", false),
        composition("comp-wipe", "Wipe", true),
        composition("comp-part-a", "Part A", true),
        composition("comp-matte", "Matte", true),
        composition("comp-part-b", "Part B", true)
      ],
      scenes: [
        {
          sceneId: "scene-master",
          displayName: null,
          compositionId: "comp-master",
          originalOrderIndex: 0,
          startTimeSeconds: 0,
          durationSeconds: 5,
          placeholders: [
            placeholder("comp-master", "Backdrop", "color"),
            placeholder("comp-part-b", "Headline", "text"),
            placeholder("comp-part-a", "Headline", "text"),
            placeholder("comp-part-a", "Screenshot", "image")
          ]
        }
      ]
    };
  }

  it("leaves out nested compositions that hold nothing a client can change", () => {
    const ids = compositionsWorthPlanning(singleMasterManifest()).map((entry) => entry.id);
    expect(ids).not.toContain("comp-wipe");
    expect(ids).not.toContain("comp-matte");
  });

  it("keeps the scene itself and every composition that directly holds an editable layer, in manifest order", () => {
    expect(compositionsWorthPlanning(singleMasterManifest()).map((entry) => entry.id)).toEqual(["comp-master", "comp-part-a", "comp-part-b"]);
  });

  it("names each composition's own editable layers with their kind", () => {
    const byId = new Map(compositionsWorthPlanning(singleMasterManifest()).map((entry) => [entry.id, entry.editableLayers]));
    expect(byId.get("comp-master")).toEqual([{ placeholderId: "comp-master-Backdrop", name: "Backdrop", kind: "color", currentText: null }]);
    expect(byId.get("comp-part-a")).toEqual([
      { placeholderId: "comp-part-a-Headline", name: "Headline", kind: "text", currentText: null },
      { placeholderId: "comp-part-a-Screenshot", name: "Screenshot", kind: "image", currentText: null }
    ]);
    expect(byId.get("comp-part-b")).toEqual([{ placeholderId: "comp-part-b-Headline", name: "Headline", kind: "text", currentText: null }]);
  });

  it("keeps a scene that has no placeholders at all - it is still a scene the client can ask about", () => {
    expect(compositionsWorthPlanning(manifest())).toEqual([
      { id: "comp-login", name: "Login Screen", editableLayers: [] },
      { id: "comp-checkout", name: "Checkout", editableLayers: [] }
    ]);
  });

  it("falls back to every composition when the manifest has no scenes, rather than sending nothing", () => {
    const empty = { ...singleMasterManifest(), scenes: [] };
    expect(compositionsWorthPlanning(empty)).toHaveLength(5);
  });

  it("the provider receives the reduced list, not the whole project", async () => {
    const provider = new StubAiWorkMapProvider({ entries: [{ sourceCompositionId: "comp-part-a", sourceReference: null, desiredAssetId: null, desiredText: "Hello", assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null }] });
    const deps = await setup(provider, singleMasterManifest());
    await generateAiWorkMapDraft(deps, deps.project.projectId, "Make a promo.");
    expect(provider.lastInput?.compositions.map((entry) => entry.id)).toEqual(["comp-master", "comp-part-a", "comp-part-b"]);
  });

  it("passes a text layer's own wording, cut to a short preview", () => {
    const m = singleMasterManifest();
    m.scenes[0]!.placeholders[1] = { ...m.scenes[0]!.placeholders[1]!, originalText: "x".repeat(500) };
    const layer = compositionsWorthPlanning(m).find((entry) => entry.id === "comp-part-b")!.editableLayers[0]!;
    expect(layer.currentText).toHaveLength(120);
  });

  describe("reconcileTargetPlaceholder - a row's claim to a layer is never taken on trust", () => {
    const row = { sourceCompositionId: "comp-master", targetPlaceholderId: "comp-part-a-Headline" };

    it("moves a row onto the composition its layer really sits in", () => {
      expect(reconcileTargetPlaceholder(row, singleMasterManifest())).toEqual({ sourceCompositionId: "comp-part-a", targetPlaceholderId: "comp-part-a-Headline" });
    });

    it("drops an id that is not a layer of this template, keeping the row as a note", () => {
      expect(reconcileTargetPlaceholder({ ...row, targetPlaceholderId: "invented" }, singleMasterManifest())).toEqual({ sourceCompositionId: "comp-master", targetPlaceholderId: null });
    });

    it("leaves a row that names no layer exactly as it was", () => {
      const sceneRow = { sourceCompositionId: "comp-master", targetPlaceholderId: null };
      expect(reconcileTargetPlaceholder(sceneRow, singleMasterManifest())).toBe(sceneRow);
    });
  });

  it("a row naming a layer is stored with that layer's id and real composition", async () => {
    const provider = new StubAiWorkMapProvider({
      entries: [{ sourceCompositionId: "comp-master", targetPlaceholderId: "comp-part-b-Headline", sourceReference: null, desiredAssetId: null, desiredText: "Hello", assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null }]
    });
    const deps = await setup(provider, singleMasterManifest());
    const workMap = await generateAiWorkMapDraft(deps, deps.project.projectId, "Make a promo.");
    expect(workMap.entries[0]).toMatchObject({ sourceCompositionId: "comp-part-b", targetPlaceholderId: "comp-part-b-Headline", desiredText: "Hello" });
  });
});

describe("buildAiSummary - what the client is shown the assistant read (real complaint 2026-10-02)", () => {
  const raw = { entries: [], businessSummary: { productName: " Acme ", tagline: "", features: ["Fast", "", 7, "Safe"], tone: "calm", notes: null } };

  it("says the website was read only when a read really succeeded - never on the model's word", () => {
    expect(buildAiSummary(raw, "https://example.com/", { attempts: 2, errorCodes: [] }).websiteRead).toBe("READ");
    expect(buildAiSummary(raw, "https://example.com/", { attempts: 4, errorCodes: ["a", "b", "c", "d"] }).websiteRead).toBe("FAILED");
    expect(buildAiSummary(raw, "https://example.com/", { attempts: 0, errorCodes: [] }).websiteRead).toBe("FAILED");
    expect(buildAiSummary(raw, "https://example.com/", undefined).websiteRead).toBe("FAILED");
    expect(buildAiSummary(raw, null, undefined).websiteRead).toBe("NOT_GIVEN");
  });

  it("takes the model's account field by field, dropping blanks and non-text", () => {
    expect(buildAiSummary(raw, null, undefined)).toMatchObject({ productName: "Acme", tagline: null, features: ["Fast", "Safe"], tone: "calm", notes: null });
  });

  it("a response with no summary at all still yields a valid, empty one - never a failed plan", () => {
    expect(buildAiSummary([], null, undefined)).toEqual({ websiteUrl: null, websiteRead: "NOT_GIVEN", productName: null, tagline: null, features: [], tone: null, notes: null });
  });

  it("is stored with the plan, and a later hand edit keeps it", async () => {
    const provider = new StubAiWorkMapProvider({
      businessSummary: { productName: "Acme", tagline: null, features: ["Fast"], tone: null, notes: null },
      entries: [{ sourceCompositionId: "comp-login", targetPlaceholderId: null, sourceReference: null, desiredAssetId: null, desiredText: "Hi", assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: null }]
    });
    const deps = await setup(provider);
    const drafted = await generateAiWorkMapDraft(deps, deps.project.projectId, "Make a promo.");
    expect(drafted.aiSummary).toMatchObject({ productName: "Acme", features: ["Fast"], websiteRead: "NOT_GIVEN" });

    const { updateWorkMap } = await import("../update-work-map.js");
    const edited = await updateWorkMap({ workMapRepository: deps.workMapRepository, now: fixedNow }, deps.project.projectId, { baseRevision: drafted.revision, entries: drafted.entries });
    expect(edited.aiSummary).toMatchObject({ productName: "Acme" });
  });
});
