import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { ProjectHasActiveJobError, ProjectNotFoundError } from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../test-support/in-memory-project-repository.js";
import { InMemoryJobRepository } from "../../job/test-support/in-memory-job-repository.js";
import { InMemoryAssetRepository } from "../../asset/test-support/in-memory-asset-repository.js";
import { InMemoryAssetStorage } from "../../asset/test-support/in-memory-asset-storage.js";
import { InMemoryExecutionSessionRepository } from "../../execution-session/test-support/in-memory-execution-session-repository.js";
import { InMemoryRenderArtifactRepository } from "../../job/test-support/in-memory-render-artifact-repository.js";
import { InMemoryRenderArtifactUploadRepository } from "../../job/test-support/in-memory-render-artifact-upload-repository.js";
import { createProject } from "../create-project.js";
import { deleteProject } from "../delete-project.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

function minimalManifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    // The disposable test-project convention this task's own instructions
    // require ("Use a disposable test project for tests. Never test
    // destructive deletion against test22.") - a fabricated path/sha256,
    // never a real Windows path from a real client project.
    sourceProject: { path: "C:\\disposable-test\\delete-project-test.aep", name: "delete-project-test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: FIXED_NOW.toISOString(),
    compositions: [],
    scenes: [],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

function setup() {
  const projectRepository = new InMemoryProjectRepository();
  const jobRepository = new InMemoryJobRepository();
  const assetRepository = new InMemoryAssetRepository();
  const assetStorage = new InMemoryAssetStorage();
  const executionSessionRepository = new InMemoryExecutionSessionRepository();
  const renderArtifactRepository = new InMemoryRenderArtifactRepository();
  const renderArtifactUploadRepository = new InMemoryRenderArtifactUploadRepository();
  return {
    deps: { projectRepository, jobRepository, assetRepository, assetStorage, executionSessionRepository, renderArtifactRepository, renderArtifactUploadRepository },
    projectRepository,
    jobRepository,
    assetRepository,
    assetStorage,
    executionSessionRepository,
    renderArtifactRepository,
    renderArtifactUploadRepository
  };
}

describe("deleteProject", () => {
  it("throws ProjectNotFoundError for a project that doesn't exist - never a silent no-op", async () => {
    const { deps } = setup();
    await expect(deleteProject(deps, randomUUID())).rejects.toThrow(ProjectNotFoundError);
  });

  it("refuses deletion while a non-terminal job exists for the project", async () => {
    const { deps, projectRepository, jobRepository } = setup();
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest() });
    await jobRepository.create(
      { id: randomUUID(), workerId: randomUUID(), projectId: project.projectId, operation: "INSPECT_SCENE_EVIDENCE", payload: {} },
      FIXED_NOW
    );

    await expect(deleteProject(deps, project.projectId)).rejects.toThrow(ProjectHasActiveJobError);
    // Refused, not partially applied - the project must still exist.
    expect(await projectRepository.findById(project.projectId)).not.toBeNull();
  });

  it("allows deletion once the project's only job has reached a terminal status", async () => {
    const { deps, projectRepository, jobRepository } = setup();
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest() });
    const job = await jobRepository.create(
      { id: randomUUID(), workerId: randomUUID(), projectId: project.projectId, operation: "INSPECT_SCENE_EVIDENCE", payload: {} },
      FIXED_NOW
    );
    await jobRepository.updateStatus(job.id, job.workerId, { expectedCurrentStatus: "QUEUED", status: "FAILED", error: { code: "TRANSPORT_ERROR", message: "x" } }, FIXED_NOW);

    await deleteProject(deps, project.projectId);
    expect(await projectRepository.findById(project.projectId)).toBeNull();
  });

  it("deletes the real DB row, removing the project from every read path", async () => {
    const { deps, projectRepository } = setup();
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest() });

    await deleteProject(deps, project.projectId);

    expect(await projectRepository.findById(project.projectId)).toBeNull();
  });

  it("deletes every real AssetStorage object this project owns - uploaded assets, session previews, and render artifact uploads", async () => {
    const { deps, projectRepository, assetRepository, assetStorage, executionSessionRepository, renderArtifactUploadRepository } = setup();
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest() });

    const storedAsset = await assetStorage.store({ projectId: project.projectId, buffer: Buffer.from("logo"), extension: "png" });
    await assetRepository.create(
      {
        id: randomUUID(),
        projectId: project.projectId,
        originalFilename: "logo.png",
        storageKey: storedAsset.storageKey,
        mediaKind: "IMAGE",
        mimeType: "image/png",
        byteSize: storedAsset.byteSize,
        sha256: storedAsset.sha256,
        width: null,
        height: null,
        durationSeconds: null,
        label: null,
        notes: null
      },
      FIXED_NOW
    );

    const session = await executionSessionRepository.create(
      { id: randomUUID(), projectId: project.projectId, executionPlanId: randomUUID(), planRevision: 1, sourceProjectSha256: "a".repeat(64), assignedWorkerId: randomUUID() },
      FIXED_NOW
    );
    await executionSessionRepository.recordPreview(session.id, { storageKey: `${project.projectId}/preview-1.png`, sha256: "c".repeat(64), scenePlanId: "scene-1", capturedAt: FIXED_NOW }, FIXED_NOW);

    await renderArtifactUploadRepository.insert(
      { id: randomUUID(), projectId: project.projectId, jobId: randomUUID(), variant: "LANDSCAPE", storageKey: `${project.projectId}/render-1.mp4`, sha256: "d".repeat(64), byteSize: 100, mimeType: "video/mp4" },
      FIXED_NOW
    );

    await deleteProject(deps, project.projectId);

    expect(assetStorage.deletedKeys).toContain(storedAsset.storageKey);
    expect(assetStorage.deletedKeys).toContain(`${project.projectId}/preview-1.png`);
    expect(assetStorage.deletedKeys).toContain(`${project.projectId}/render-1.mp4`);
  });

  it("deletes the DB row before any storage file - if a storage delete fails, the project is already gone from every API", async () => {
    const { deps, projectRepository, assetRepository, assetStorage } = setup();
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest() });
    await assetRepository.create(
      {
        id: randomUUID(),
        projectId: project.projectId,
        originalFilename: "logo.png",
        storageKey: `${project.projectId}/asset-1.png`,
        mediaKind: "IMAGE",
        mimeType: "image/png",
        byteSize: 10,
        sha256: "b".repeat(64),
        width: null,
        height: null,
        durationSeconds: null,
        label: null,
        notes: null
      },
      FIXED_NOW
    );

    let projectGoneWhenStorageDeleteRan = false;
    const originalDelete = assetStorage.delete.bind(assetStorage);
    assetStorage.delete = async (storageKey: string) => {
      projectGoneWhenStorageDeleteRan = (await projectRepository.findById(project.projectId)) === null;
      return originalDelete(storageKey);
    };

    await deleteProject(deps, project.projectId);
    expect(projectGoneWhenStorageDeleteRan).toBe(true);
  });

  it("never touches the Windows worker's own filesystem - the original .aep path is never passed to AssetStorage", async () => {
    const { deps, projectRepository, assetStorage } = setup();
    const project = await createProject({ projectRepository, now: () => FIXED_NOW }, { name: "P", manifest: minimalManifest() });

    await deleteProject(deps, project.projectId);

    expect(assetStorage.deletedKeys).not.toContain(minimalManifest().sourceProject.path);
    expect(assetStorage.deletedKeys.some((key) => key.includes(".aep"))).toBe(false);
  });
});
