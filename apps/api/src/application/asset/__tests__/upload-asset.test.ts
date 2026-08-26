import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { PayloadTooLargeError, ProjectNotFoundError, UnsupportedMediaTypeError } from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { createProject } from "../../project/create-project.js";
import { InMemoryAssetRepository } from "../test-support/in-memory-asset-repository.js";
import { InMemoryAssetStorage } from "../test-support/in-memory-asset-storage.js";
import { uploadAsset } from "../upload-asset.js";
import type { AssetRepository, AssetUpdate, NewAssetRecord, AssetRecord } from "../../../domain/asset/types.js";

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
    compositions: [],
    scenes: [],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

async function setup() {
  const projectRepository = new InMemoryProjectRepository();
  const assetRepository = new InMemoryAssetRepository();
  const assetStorage = new InMemoryAssetStorage();
  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifest() });
  return { projectRepository, assetRepository, assetStorage, project };
}

describe("uploadAsset", () => {
  it("stores the file, computes a real sha256 from the actual bytes, and persists metadata", async () => {
    const { projectRepository, assetRepository, assetStorage, project } = await setup();
    const buffer = Buffer.from("fake png bytes");
    const asset = await uploadAsset(
      { assetRepository, assetStorage, projectRepository, maxUploadBytes: 1000, now: fixedNow },
      project.projectId,
      { originalFilename: "hero.png", mimeType: "image/png", buffer, requestedMediaKind: null }
    );

    expect(asset.mediaKind).toBe("IMAGE");
    expect(asset.byteSize).toBe(buffer.length);
    expect(asset.sha256).toBe(createHash("sha256").update(buffer).digest("hex"));
    expect(assetStorage.has(asset.storageKey)).toBe(true);
  });

  it("never derives a storage path/name from the client's original filename - two uploads with the IDENTICAL filename never collide or overwrite", async () => {
    const { projectRepository, assetRepository, assetStorage, project } = await setup();
    const first = await uploadAsset(
      { assetRepository, assetStorage, projectRepository, maxUploadBytes: 1000, now: fixedNow },
      project.projectId,
      { originalFilename: "logo.png", mimeType: "image/png", buffer: Buffer.from("one"), requestedMediaKind: null }
    );
    const second = await uploadAsset(
      { assetRepository, assetStorage, projectRepository, maxUploadBytes: 1000, now: fixedNow },
      project.projectId,
      { originalFilename: "logo.png", mimeType: "image/png", buffer: Buffer.from("two"), requestedMediaKind: null }
    );

    expect(first.storageKey).not.toBe(second.storageKey);
    expect(assetStorage.has(first.storageKey)).toBe(true);
    expect(assetStorage.has(second.storageKey)).toBe(true);
  });

  it("allows the LOGO override only for an image mime type", async () => {
    const { projectRepository, assetRepository, assetStorage, project } = await setup();
    const asset = await uploadAsset(
      { assetRepository, assetStorage, projectRepository, maxUploadBytes: 1000, now: fixedNow },
      project.projectId,
      { originalFilename: "logo.png", mimeType: "image/png", buffer: Buffer.from("x"), requestedMediaKind: "LOGO" }
    );
    expect(asset.mediaKind).toBe("LOGO");
  });

  it("rejects a LOGO override requested against a non-image mime type", async () => {
    const { projectRepository, assetRepository, assetStorage, project } = await setup();
    await expect(
      uploadAsset({ assetRepository, assetStorage, projectRepository, maxUploadBytes: 1000, now: fixedNow }, project.projectId, {
        originalFilename: "clip.mp4",
        mimeType: "video/mp4",
        buffer: Buffer.from("x"),
        requestedMediaKind: "LOGO"
      })
    ).rejects.toThrow(UnsupportedMediaTypeError);
  });

  it("rejects an unsupported MIME type outright - never buckets it into a generic OTHER kind", async () => {
    const { projectRepository, assetRepository, assetStorage, project } = await setup();
    await expect(
      uploadAsset({ assetRepository, assetStorage, projectRepository, maxUploadBytes: 1000, now: fixedNow }, project.projectId, {
        originalFilename: "vector.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from("<svg/>"),
        requestedMediaKind: null
      })
    ).rejects.toThrow(UnsupportedMediaTypeError);
  });

  it("rejects a file over the configured upload size limit", async () => {
    const { projectRepository, assetRepository, assetStorage, project } = await setup();
    await expect(
      uploadAsset({ assetRepository, assetStorage, projectRepository, maxUploadBytes: 4, now: fixedNow }, project.projectId, {
        originalFilename: "big.png",
        mimeType: "image/png",
        buffer: Buffer.from("way too big"),
        requestedMediaKind: null
      })
    ).rejects.toThrow(PayloadTooLargeError);
  });

  it("rejects an upload against a project that does not exist", async () => {
    const { projectRepository, assetRepository, assetStorage } = await setup();
    await expect(
      uploadAsset({ assetRepository, assetStorage, projectRepository, maxUploadBytes: 1000, now: fixedNow }, "does-not-exist", {
        originalFilename: "x.png",
        mimeType: "image/png",
        buffer: Buffer.from("x"),
        requestedMediaKind: null
      })
    ).rejects.toThrow(ProjectNotFoundError);
  });

  it("cleans up the just-written file if persisting metadata fails - never leaves an orphaned file behind", async () => {
    const { projectRepository, assetStorage, project } = await setup();
    class ThrowingAssetRepository implements AssetRepository {
      async create(_record: NewAssetRecord, _now: Date): Promise<AssetRecord> {
        throw new Error("simulated database failure");
      }
      async findById(): Promise<AssetRecord | null> {
        return null;
      }
      async listByProjectId(): Promise<AssetRecord[]> {
        return [];
      }
      async update(_id: string, _update: AssetUpdate, _now: Date): Promise<AssetRecord | null> {
        return null;
      }
      async delete(): Promise<boolean> {
        return false;
      }
    }
    const assetRepository = new ThrowingAssetRepository();

    await expect(
      uploadAsset({ assetRepository, assetStorage, projectRepository, maxUploadBytes: 1000, now: fixedNow }, project.projectId, {
        originalFilename: "x.png",
        mimeType: "image/png",
        buffer: Buffer.from("x"),
        requestedMediaKind: null
      })
    ).rejects.toThrow("simulated database failure");

    expect(assetStorage.deletedKeys).toHaveLength(1);
    expect(assetStorage.has(assetStorage.deletedKeys[0] as string)).toBe(false);
  });
});
