import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SceneEditOperationIntent } from "@dyo/schemas";
import { resolveSceneEditOperation } from "../resolve-scene-edit-operation.js";
import type { AssetDownloadClient } from "../../workspace/asset-cache.js";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function makeWorkRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "resolve-op-test-"));
  cleanupDirs.push(root);
  return root;
}

class FakeAssetDownloadClient implements AssetDownloadClient {
  calls = 0;
  constructor(private readonly buffer: Buffer) {}
  async download(): Promise<Buffer> {
    this.calls++;
    return this.buffer;
  }
}

describe("resolveSceneEditOperation", () => {
  it("passes every non-MAP_FOOTAGE intent through unchanged - never touches the asset download client", async () => {
    const client = new FakeAssetDownloadClient(Buffer.from(""));
    const intents: SceneEditOperationIntent[] = [
      { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "Hello" },
      { type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-2", layerIndex: 2, visible: false },
      { type: "SET_TIME_REMAP_FREEZE", manifestPlaceholderId: "ph-3", layerIndex: 3, freezeAtSeconds: 1.5 },
      { type: "SET_DURATION", manifestPlaceholderId: "ph-4", layerIndex: 4, durationSeconds: 4 },
      { type: "SET_BRAND_COLOR", manifestPlaceholderId: "ph-5", layerIndex: 5, colorHex: "#1A2B3C" }
    ];

    for (const intent of intents) {
      const result = await resolveSceneEditOperation(
        { workRoot: makeWorkRoot(), jobId: "job-1", assetDownloadClient: client },
        intent
      );
      expect(result).toEqual({ ok: true, operation: intent });
    }
    expect(client.calls).toBe(0);
  });

  it("resolves a MAP_FOOTAGE intent into a real, resolved operation with a local assetPath", async () => {
    const workRoot = makeWorkRoot();
    const content = "real video bytes";
    const client = new FakeAssetDownloadClient(Buffer.from(content));

    const intent: SceneEditOperationIntent = {
      type: "MAP_FOOTAGE",
      manifestPlaceholderId: "ph-1",
      layerIndex: 1,
      assetId: "22222222-2222-2222-2222-222222222222",
      expectedSha256: sha256(content),
      mimeType: "video/mp4"
    };

    const result = await resolveSceneEditOperation({ workRoot, jobId: "job-2", assetDownloadClient: client }, intent);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operation.type).toBe("MAP_FOOTAGE");
      if (result.operation.type === "MAP_FOOTAGE") {
        expect(result.operation.manifestPlaceholderId).toBe("ph-1");
        expect(result.operation.layerIndex).toBe(1);
        expect(result.operation.assetPath).toContain("job-2");
        expect(result.operation.assetPath.endsWith(".mp4")).toBe(true);
      }
    }
  });

  it("propagates a clean failure (never throws) when the asset cannot be resolved - e.g. sha256 mismatch", async () => {
    const workRoot = makeWorkRoot();
    const client = new FakeAssetDownloadClient(Buffer.from("wrong bytes"));

    const intent: SceneEditOperationIntent = {
      type: "MAP_FOOTAGE",
      manifestPlaceholderId: "ph-1",
      layerIndex: 1,
      assetId: "22222222-2222-2222-2222-222222222222",
      expectedSha256: sha256("expected bytes"),
      mimeType: "video/mp4"
    };

    const result = await resolveSceneEditOperation({ workRoot, jobId: "job-3", assetDownloadClient: client }, intent);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("sha256");
    }
  });
});
