import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { AssetCrossProjectAccessError, AssetInUseError, AssetNotFoundError, ProjectNotFoundError } from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { createProject } from "../../project/create-project.js";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { createExecutionPlan } from "../../execution-plan/create-execution-plan.js";
import { updateExecutionPlan } from "../../execution-plan/update-execution-plan.js";
import { InMemoryWorkMapRepository } from "../../work-map/test-support/in-memory-work-map-repository.js";
import { updateWorkMap } from "../../work-map/update-work-map.js";
import { InMemoryAssetRepository } from "../test-support/in-memory-asset-repository.js";
import { InMemoryAssetStorage } from "../test-support/in-memory-asset-storage.js";
import { uploadAsset } from "../upload-asset.js";
import { listAssets } from "../list-assets.js";
import { getAsset } from "../get-asset.js";
import { getAssetFile } from "../get-asset-file.js";
import { updateAsset } from "../update-asset.js";
import { deleteAsset } from "../delete-asset.js";

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
        durationSeconds: 5,
        startTimeSeconds: 0,
        placeholders: [
          {
            placeholderId: "ph-1",
            displayLabel: null,
            compositionId: "comp-1",
            layerName: "Headline",
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

async function setup() {
  const projectRepository = new InMemoryProjectRepository();
  const assetRepository = new InMemoryAssetRepository();
  const assetStorage = new InMemoryAssetStorage();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const workMapRepository = new InMemoryWorkMapRepository();
  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifest() });
  const other = await createProject({ projectRepository, now: fixedNow }, { name: "Other Project", manifest: manifest() });
  return { projectRepository, assetRepository, assetStorage, executionPlanRepository, workMapRepository, project, other };
}

async function upload(deps: Awaited<ReturnType<typeof setup>>, projectId: string, filename = "hero.png") {
  return uploadAsset(
    { assetRepository: deps.assetRepository, assetStorage: deps.assetStorage, projectRepository: deps.projectRepository, maxUploadBytes: 1000, now: fixedNow },
    projectId,
    { originalFilename: filename, mimeType: "image/png", buffer: Buffer.from("bytes"), requestedMediaKind: null }
  );
}

describe("listAssets", () => {
  it("returns only this project's assets, never another project's", async () => {
    const deps = await setup();
    const mine = await upload(deps, deps.project.projectId);
    await upload(deps, deps.other.projectId);

    const result = await listAssets(deps, deps.project.projectId);
    expect(result.map((a) => a.id)).toEqual([mine.id]);
  });

  it("throws ProjectNotFoundError for a nonexistent project", async () => {
    const deps = await setup();
    await expect(listAssets(deps, "does-not-exist")).rejects.toThrow(ProjectNotFoundError);
  });
});

describe("getAsset / getAssetFile", () => {
  it("returns the real asset for its own project", async () => {
    const deps = await setup();
    const uploaded = await upload(deps, deps.project.projectId);
    const found = await getAsset({ assetRepository: deps.assetRepository }, deps.project.projectId, uploaded.id);
    expect(found.id).toBe(uploaded.id);
  });

  it("refuses cross-project access with the SAME error as a nonexistent asset", async () => {
    const deps = await setup();
    const uploaded = await upload(deps, deps.other.projectId);
    await expect(getAsset({ assetRepository: deps.assetRepository }, deps.project.projectId, uploaded.id)).rejects.toThrow(
      AssetCrossProjectAccessError
    );
    await expect(getAsset({ assetRepository: deps.assetRepository }, deps.project.projectId, "totally-unknown-id")).rejects.toThrow(
      AssetNotFoundError
    );
  });

  it("streams back the real stored bytes and mimeType - never a filesystem path", async () => {
    const deps = await setup();
    const uploaded = await upload(deps, deps.project.projectId);
    const file = await getAssetFile(
      { assetRepository: deps.assetRepository, assetStorage: deps.assetStorage },
      deps.project.projectId,
      uploaded.id
    );
    expect(file.buffer.toString()).toBe("bytes");
    expect(file.mimeType).toBe("image/png");
    expect(file.originalFilename).toBe("hero.png");
  });
});

describe("updateAsset", () => {
  it("updates label/notes only - every other fact is fixed at upload time", async () => {
    const deps = await setup();
    const uploaded = await upload(deps, deps.project.projectId);
    const updated = await updateAsset({ assetRepository: deps.assetRepository, now: fixedNow }, deps.project.projectId, uploaded.id, {
      label: "Client logo",
      notes: "Approved by client"
    });
    expect(updated.label).toBe("Client logo");
    expect(updated.notes).toBe("Approved by client");
    expect(updated.mimeType).toBe(uploaded.mimeType);
    expect(updated.sha256).toBe(uploaded.sha256);
  });

  it("refuses to update an asset belonging to a different project", async () => {
    const deps = await setup();
    const uploaded = await upload(deps, deps.other.projectId);
    await expect(
      updateAsset({ assetRepository: deps.assetRepository, now: fixedNow }, deps.project.projectId, uploaded.id, { label: "x" })
    ).rejects.toThrow(AssetCrossProjectAccessError);
  });
});

describe("deleteAsset", () => {
  it("deletes both the DB row and the storage file", async () => {
    const deps = await setup();
    const uploaded = await upload(deps, deps.project.projectId);
    await deleteAsset(
      { assetRepository: deps.assetRepository, assetStorage: deps.assetStorage, executionPlanRepository: deps.executionPlanRepository, projectRepository: deps.projectRepository },
      deps.project.projectId,
      uploaded.id
    );
    expect(await deps.assetRepository.findById(uploaded.id)).toBeNull();
    expect(deps.assetStorage.has(uploaded.storageKey)).toBe(false);
  });

  it("refuses cross-project deletion", async () => {
    const deps = await setup();
    const uploaded = await upload(deps, deps.other.projectId);
    await expect(
      deleteAsset(
        { assetRepository: deps.assetRepository, assetStorage: deps.assetStorage, executionPlanRepository: deps.executionPlanRepository, projectRepository: deps.projectRepository },
        deps.project.projectId,
        uploaded.id
      )
    ).rejects.toThrow(AssetCrossProjectAccessError);
  });

  it("refuses to delete an asset still mapped to a scene in the CURRENT execution plan revision (must CLEAR_ASSET first)", async () => {
    const deps = await setup();
    const uploaded = await upload(deps, deps.project.projectId);
    const created = await createExecutionPlan(
      { projectRepository: deps.projectRepository, executionPlanRepository: deps.executionPlanRepository, now: fixedNow },
      deps.project.projectId
    );
    const scenePlanId = created.plan.scenePlans[0]?.id as string;
    const mappingId = created.plan.scenePlans[0]?.mappings[0]?.id as string;
    await updateExecutionPlan(
      { executionPlanRepository: deps.executionPlanRepository, assetRepository: deps.assetRepository, now: fixedNow },
      deps.project.projectId,
      { baseRevision: 1, operations: [{ type: "MAP_ASSET", scenePlanId, mappingId, selectedAssetId: uploaded.id, selectedAssetType: "image" }] }
    );

    await expect(
      deleteAsset(
        { assetRepository: deps.assetRepository, assetStorage: deps.assetStorage, executionPlanRepository: deps.executionPlanRepository, projectRepository: deps.projectRepository },
        deps.project.projectId,
        uploaded.id
      )
    ).rejects.toThrow(AssetInUseError);

    // Never silently deleted, never left in a half-deleted state.
    expect(await deps.assetRepository.findById(uploaded.id)).not.toBeNull();
    expect(deps.assetStorage.has(uploaded.storageKey)).toBe(true);
  });

  it("allows deletion again once CLEAR_ASSET has unmapped it", async () => {
    const deps = await setup();
    const uploaded = await upload(deps, deps.project.projectId);
    const created = await createExecutionPlan(
      { projectRepository: deps.projectRepository, executionPlanRepository: deps.executionPlanRepository, now: fixedNow },
      deps.project.projectId
    );
    const scenePlanId = created.plan.scenePlans[0]?.id as string;
    const mappingId = created.plan.scenePlans[0]?.mappings[0]?.id as string;
    await updateExecutionPlan(
      { executionPlanRepository: deps.executionPlanRepository, assetRepository: deps.assetRepository, now: fixedNow },
      deps.project.projectId,
      { baseRevision: 1, operations: [{ type: "MAP_ASSET", scenePlanId, mappingId, selectedAssetId: uploaded.id, selectedAssetType: "image" }] }
    );
    await updateExecutionPlan(
      { executionPlanRepository: deps.executionPlanRepository, assetRepository: deps.assetRepository, now: fixedNow },
      deps.project.projectId,
      { baseRevision: 2, operations: [{ type: "CLEAR_ASSET", scenePlanId, mappingId }] }
    );

    await deleteAsset(
      { assetRepository: deps.assetRepository, assetStorage: deps.assetStorage, executionPlanRepository: deps.executionPlanRepository, projectRepository: deps.projectRepository },
      deps.project.projectId,
      uploaded.id
    );
    expect(await deps.assetRepository.findById(uploaded.id)).toBeNull();
  });

  it("refuses to delete an asset currently set as the project's brand logo (must clear the logo first)", async () => {
    const deps = await setup();
    const uploaded = await upload(deps, deps.project.projectId);
    await deps.projectRepository.updateBrandInputs(
      deps.project.projectId,
      { logoAssetId: uploaded.id, brandColors: [], textInstructions: null },
      fixedNow()
    );

    await expect(
      deleteAsset(
        { assetRepository: deps.assetRepository, assetStorage: deps.assetStorage, executionPlanRepository: deps.executionPlanRepository, projectRepository: deps.projectRepository },
        deps.project.projectId,
        uploaded.id
      )
    ).rejects.toThrow(AssetInUseError);

    // Never silently deleted, never left with a dangling active brand-logo reference.
    expect(await deps.assetRepository.findById(uploaded.id)).not.toBeNull();
    expect(deps.assetStorage.has(uploaded.storageKey)).toBe(true);
  });

  it("allows deletion once the brand logo reference has been cleared", async () => {
    const deps = await setup();
    const uploaded = await upload(deps, deps.project.projectId);
    await deps.projectRepository.updateBrandInputs(
      deps.project.projectId,
      { logoAssetId: uploaded.id, brandColors: [], textInstructions: null },
      fixedNow()
    );
    await deps.projectRepository.updateBrandInputs(deps.project.projectId, { logoAssetId: null, brandColors: [], textInstructions: null }, fixedNow());

    await deleteAsset(
      { assetRepository: deps.assetRepository, assetStorage: deps.assetStorage, executionPlanRepository: deps.executionPlanRepository, projectRepository: deps.projectRepository },
      deps.project.projectId,
      uploaded.id
    );
    expect(await deps.assetRepository.findById(uploaded.id)).toBeNull();
  });

  it("does NOT block deletion for an asset only referenced by a Work Map entry's desiredAssetId - work-map is unvalidated intent, never an enforced reference", async () => {
    const deps = await setup();
    const uploaded = await upload(deps, deps.project.projectId);
    // A real work-map entry references this asset id - never validated
    // against the catalog when saved (see update-work-map.ts's own doc
    // comment) - deleting the asset it merely mentions must still
    // succeed; only a real execution-plan mapping or the project's own
    // brandInputs.logoAssetId are treated as active, enforced references.
    await updateWorkMap({ workMapRepository: deps.workMapRepository, now: fixedNow }, deps.project.projectId, {
      baseRevision: 0,
      entries: [
        {
          sourceCompositionId: null,
          sourceReference: "Scene 1",
          desiredAssetId: uploaded.id,
          desiredText: null,
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      ]
    });

    await deleteAsset(
      { assetRepository: deps.assetRepository, assetStorage: deps.assetStorage, executionPlanRepository: deps.executionPlanRepository, projectRepository: deps.projectRepository },
      deps.project.projectId,
      uploaded.id
    );
    expect(await deps.assetRepository.findById(uploaded.id)).toBeNull();
  });
});
