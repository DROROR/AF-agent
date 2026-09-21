import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { PayloadTooLargeError, ProjectNotFoundError, UnsupportedMediaTypeError } from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { createProject } from "../../project/create-project.js";
import { InMemoryAssetRepository } from "../test-support/in-memory-asset-repository.js";
import { InMemoryAssetStorage } from "../test-support/in-memory-asset-storage.js";
import { uploadAsset } from "../upload-asset.js";
import { realImageBytes } from "../../../domain/asset/test-support/real-image-fixtures.js";
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

  it("measures real dimensions and transparency from the uploaded bytes", async () => {
    const { projectRepository, assetRepository, assetStorage, project } = await setup();
    const buffer = realImageBytes("pngTransparentLogo");
    const asset = await uploadAsset(
      { assetRepository, assetStorage, projectRepository, maxUploadBytes: 10_000, now: fixedNow },
      project.projectId,
      // A filename that lies about the picture entirely - nothing here may be
      // read from it.
      { originalFilename: "1920x1080-opaque-banner.png", mimeType: "image/png", buffer, requestedMediaKind: null }
    );

    expect(asset.width).toBe(20);
    expect(asset.height).toBe(20);
    // The file CAN carry transparency, and its pixels actually use it - two
    // separate facts, both recorded.
    expect(asset.hasAlphaChannel).toBe(true);
    expect(asset.hasTransparentPixels).toBe(true);
    expect(asset.transparentPixelRatio).toBeCloseTo(1 - 64 / 400, 6);
    expect(asset.visibleContentBounds).toEqual({ xPx: 6, yPx: 6, widthPx: 8, heightPx: 8 });
  });

  it("records an opaque RGBA screenshot as opaque, although its file carries an alpha channel", async () => {
    const { projectRepository, assetRepository, assetStorage, project } = await setup();
    const asset = await uploadAsset(
      { assetRepository, assetStorage, projectRepository, maxUploadBytes: 10_000, now: fixedNow },
      project.projectId,
      { originalFilename: "screenshot.png", mimeType: "image/png", buffer: realImageBytes("pngOpaqueRgba"), requestedMediaKind: null }
    );

    expect(asset.hasAlphaChannel).toBe(true);
    expect(asset.hasTransparentPixels).toBe(false);
    expect(asset.transparentPixelRatio).toBe(0);
    expect(asset.visibleCoverageRatio).toBe(1);
  });

  it("records a WebP that declares alpha as UNKNOWN, since its pixels cannot be decoded here", async () => {
    const { projectRepository, assetRepository, assetStorage, project } = await setup();
    const asset = await uploadAsset(
      { assetRepository, assetStorage, projectRepository, maxUploadBytes: 10_000, now: fixedNow },
      project.projectId,
      { originalFilename: "logo.webp", mimeType: "image/webp", buffer: realImageBytes("webpOpaqueWithAlphaCapability"), requestedMediaKind: null }
    );

    expect(asset.hasAlphaChannel).toBe(true);
    expect(asset.hasTransparentPixels).toBeNull();
    expect(asset.transparentPixelRatio).toBeNull();
  });

  it("records an opaque JPEG as measured and opaque, not as unmeasured", async () => {
    const { projectRepository, assetRepository, assetStorage, project } = await setup();
    const asset = await uploadAsset(
      { assetRepository, assetStorage, projectRepository, maxUploadBytes: 10_000, now: fixedNow },
      project.projectId,
      { originalFilename: "photo.jpg", mimeType: "image/jpeg", buffer: realImageBytes("jpegOpaque"), requestedMediaKind: null }
    );

    expect(asset.width).toBe(9);
    expect(asset.height).toBe(7);
    expect(asset.hasAlphaChannel).toBe(false);
    expect(asset.hasTransparentPixels).toBe(false);
  });

  it("leaves dimensions unmeasured rather than guessing when the bytes cannot be read", async () => {
    const { projectRepository, assetRepository, assetStorage, project } = await setup();
    const asset = await uploadAsset(
      { assetRepository, assetStorage, projectRepository, maxUploadBytes: 10_000, now: fixedNow },
      project.projectId,
      // A real MP4 needs a demuxer this host does not have; an unreadable PNG
      // is measured as nothing at all rather than as a default size.
      { originalFilename: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("not really a video"), requestedMediaKind: null }
    );

    expect(asset.width).toBeNull();
    expect(asset.height).toBeNull();
    expect(asset.hasAlphaChannel).toBeNull();
    expect(asset.hasTransparentPixels).toBeNull();
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
