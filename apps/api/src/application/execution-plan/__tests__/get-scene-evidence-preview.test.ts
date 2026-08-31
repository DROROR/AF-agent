import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { ExecutionPlanNotFoundError, SceneEvidencePreviewNotFoundError } from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../test-support/in-memory-execution-plan-repository.js";
import { InMemorySceneEvidencePreviewRepository } from "../../../domain/scene-evidence-preview/test-support/in-memory-scene-evidence-preview-repository.js";
import { InMemoryAssetStorage } from "../../asset/test-support/in-memory-asset-storage.js";
import { createProject } from "../../project/create-project.js";
import { createExecutionPlan } from "../create-execution-plan.js";
import { getSceneEvidencePreviewMetadata, getSceneEvidencePreviewFile } from "../get-scene-evidence-preview.js";

const NOW = new Date("2026-08-31T00:00:00.000Z");
const fixedNow = () => NOW;
const SHA = "a".repeat(64);

function manifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: SHA },
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
  const sceneEvidencePreviewRepository = new InMemorySceneEvidencePreviewRepository();
  const assetStorage = new InMemoryAssetStorage();
  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifest() });
  const created = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
  const scenePlanId = created.plan.scenePlans[0]?.id as string;
  return { executionPlanRepository, sceneEvidencePreviewRepository, assetStorage, projectId: project.projectId, scenePlanId };
}

describe("getSceneEvidencePreviewMetadata", () => {
  it("throws ExecutionPlanNotFoundError when no plan exists for the project", async () => {
    const executionPlanRepository = new InMemoryExecutionPlanRepository();
    const sceneEvidencePreviewRepository = new InMemorySceneEvidencePreviewRepository();
    await expect(getSceneEvidencePreviewMetadata({ executionPlanRepository, sceneEvidencePreviewRepository }, "does-not-exist", "scene-1")).rejects.toThrow(ExecutionPlanNotFoundError);
  });

  it("throws ExecutionPlanNotFoundError when the plan exists but has no scene matching scenePlanId", async () => {
    const { executionPlanRepository, sceneEvidencePreviewRepository, projectId } = await setup();
    await expect(getSceneEvidencePreviewMetadata({ executionPlanRepository, sceneEvidencePreviewRepository }, projectId, "not-a-real-scene")).rejects.toThrow(ExecutionPlanNotFoundError);
  });

  it("returns null (not an error) when the scene's composition has never had a preview captured", async () => {
    const { executionPlanRepository, sceneEvidencePreviewRepository, projectId, scenePlanId } = await setup();
    const result = await getSceneEvidencePreviewMetadata({ executionPlanRepository, sceneEvidencePreviewRepository }, projectId, scenePlanId);
    expect(result).toBeNull();
  });

  it("returns the composition's latest captured preview as a DTO", async () => {
    const { executionPlanRepository, sceneEvidencePreviewRepository, projectId, scenePlanId } = await setup();
    await sceneEvidencePreviewRepository.record(
      {
        id: randomUUID(),
        projectId,
        jobId: randomUUID(),
        manifestCompositionId: "comp-1",
        sourceProjectSha256: SHA,
        filename: "scene-preview-Scene_A.png",
        mimeType: "image/png",
        byteSize: 42,
        storageKey: "key-1",
        sha256: "b".repeat(64),
        capturedAt: NOW
      },
      NOW
    );

    const result = await getSceneEvidencePreviewMetadata({ executionPlanRepository, sceneEvidencePreviewRepository }, projectId, scenePlanId);
    expect(result?.manifestCompositionId).toBe("comp-1");
    expect(result?.filename).toBe("scene-preview-Scene_A.png");
  });
});

describe("getSceneEvidencePreviewFile", () => {
  it("throws SceneEvidencePreviewNotFoundError when no preview has ever been captured for this scene's composition", async () => {
    const { executionPlanRepository, sceneEvidencePreviewRepository, assetStorage, projectId, scenePlanId } = await setup();
    await expect(getSceneEvidencePreviewFile({ executionPlanRepository, sceneEvidencePreviewRepository, assetStorage }, projectId, scenePlanId)).rejects.toThrow(SceneEvidencePreviewNotFoundError);
  });

  it("returns the real stored bytes and mimeType for the latest captured preview", async () => {
    const { executionPlanRepository, sceneEvidencePreviewRepository, assetStorage, projectId, scenePlanId } = await setup();
    const buffer = Buffer.from("real png bytes");
    const stored = await assetStorage.store({ projectId, buffer, extension: "png" });
    await sceneEvidencePreviewRepository.record(
      {
        id: randomUUID(),
        projectId,
        jobId: randomUUID(),
        manifestCompositionId: "comp-1",
        sourceProjectSha256: SHA,
        filename: "scene-preview-Scene_A.png",
        mimeType: "image/png",
        byteSize: stored.byteSize,
        storageKey: stored.storageKey,
        sha256: stored.sha256,
        capturedAt: NOW
      },
      NOW
    );

    const file = await getSceneEvidencePreviewFile({ executionPlanRepository, sceneEvidencePreviewRepository, assetStorage }, projectId, scenePlanId);
    expect(file.mimeType).toBe("image/png");
    expect(file.buffer.equals(buffer)).toBe(true);
  });
});
