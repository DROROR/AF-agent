import { describe, expect, it, vi } from "vitest";
import type { SceneMap } from "../../scene-map/scene-map.js";
import { DYO_REQUIRED_HEBREW_TEXT } from "../../scene-map/validate-scene-map.js";
import { ShotstackClient } from "./shotstack-client.js";
import { ShotstackRenderer } from "./shotstack-renderer.js";

const sceneMap: SceneMap = {
  projectId: "project-1",
  brandColor: "#0057FF",
  logoAssetUrl: "https://example.com/logo.png",
  scenes: [
    {
      sceneId: "scene-1",
      label: "Opening",
      startMs: 0,
      durationMs: 3000,
      assets: [],
      texts: [{ placeholderId: "t1", content: DYO_REQUIRED_HEBREW_TEXT }]
    }
  ]
};

function fakeClient(): ShotstackClient {
  return {
    createRender: vi.fn().mockResolvedValue({ id: "render-1" }),
    getRenderStatus: vi
      .fn()
      .mockResolvedValue({ id: "render-1", status: "rendering", url: null, error: null })
  } as unknown as ShotstackClient;
}

describe("ShotstackRenderer", () => {
  it("validates projects using the same shared rules as every other provider", async () => {
    const renderer = new ShotstackRenderer(fakeClient());
    const result = await renderer.validateProject(sceneMap);
    expect(result.valid).toBe(true);
  });

  it("reports scenes with no assets or text as missing during prepareAssets", async () => {
    const renderer = new ShotstackRenderer(fakeClient());
    const emptyScene: SceneMap = {
      ...sceneMap,
      scenes: [{ sceneId: "empty-scene", label: "Empty", startMs: 0, durationMs: 1000, assets: [], texts: [] }]
    };
    const result = await renderer.prepareAssets(emptyScene);
    expect(result).toEqual({ ready: false, missing: ["empty-scene"] });
  });

  it("renderLandscape submits a real Shotstack create-render call and returns a handle", async () => {
    const client = fakeClient();
    const renderer = new ShotstackRenderer(client);

    const handle = await renderer.renderLandscape(sceneMap);

    expect(handle).toEqual({ provider: "shotstack", externalId: "render-1" });
    expect(client.createRender).toHaveBeenCalledTimes(1);
  });

  it("renderReels uses the 1080x1920 output size", async () => {
    const client = fakeClient();
    const renderer = new ShotstackRenderer(client);

    await renderer.renderReels(sceneMap);

    const payload = (client.createRender as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(payload.output.size).toEqual({ width: 1080, height: 1920 });
  });

  it("createPreview triggers a real render (documented POC simplification) and returns its handle", async () => {
    const client = fakeClient();
    const renderer = new ShotstackRenderer(client);

    const preview = await renderer.createPreview(sceneMap);

    expect(preview.previewUrl).toBeNull();
    expect(preview.handle).toEqual({ provider: "shotstack", externalId: "render-1" });
  });

  it("getRenderStatus maps the provider's raw status through the shared status vocabulary", async () => {
    const client = fakeClient();
    const renderer = new ShotstackRenderer(client);

    const status = await renderer.getRenderStatus({ provider: "shotstack", externalId: "render-1" });

    expect(status.status).toBe("PROCESSING");
    expect(status.providerStatus).toBe("rendering");
  });
});
