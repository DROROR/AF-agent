import { describe, expect, it } from "vitest";
import { RendererNotImplementedError } from "../../errors.js";
import { DYO_REQUIRED_HEBREW_TEXT } from "../../scene-map/validate-scene-map.js";
import type { SceneMap } from "../../scene-map/scene-map.js";
import { AfterEffectsRenderer } from "./after-effects-renderer.js";

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

describe("AfterEffectsRenderer", () => {
  it("genuinely validates projects - no AE dependency needed for that", async () => {
    const renderer = new AfterEffectsRenderer();
    const result = await renderer.validateProject(sceneMap);
    expect(result.valid).toBe(true);
  });

  it("throws RendererNotImplementedError for prepareAssets rather than fabricating success", async () => {
    const renderer = new AfterEffectsRenderer();
    await expect(renderer.prepareAssets()).rejects.toThrow(RendererNotImplementedError);
  });

  it("throws RendererNotImplementedError for every render/status method", async () => {
    const renderer = new AfterEffectsRenderer();
    await expect(renderer.createPreview()).rejects.toThrow(RendererNotImplementedError);
    await expect(renderer.renderLandscape()).rejects.toThrow(RendererNotImplementedError);
    await expect(renderer.renderReels()).rejects.toThrow(RendererNotImplementedError);
    await expect(renderer.getRenderStatus()).rejects.toThrow(RendererNotImplementedError);
  });

  it("names itself after-effects so provider selection can find it", () => {
    expect(new AfterEffectsRenderer().name).toBe("after-effects");
  });
});
