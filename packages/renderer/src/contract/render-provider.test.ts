import { describe, expect, it } from "vitest";
import type { SceneMap } from "../scene-map/scene-map.js";
import { validateSceneMap } from "../scene-map/validate-scene-map.js";
import {
  RENDER_OUTPUT_KINDS,
  RENDER_STATUSES,
  type RenderHandle,
  type RenderProvider,
  type RenderStatusResult
} from "./render-provider.js";

/** A minimal fake used only to prove any object matching the shape works as a RenderProvider - the actual providers are tested in providers/. */
function makeFakeProvider(): RenderProvider {
  return {
    name: "fake",
    validateProject: async (sceneMap: SceneMap) => validateSceneMap(sceneMap),
    prepareAssets: async () => ({ ready: true, missing: [] }),
    createPreview: async () => ({ previewUrl: "https://example.com/preview.mp4", handle: null }),
    renderLandscape: async (): Promise<RenderHandle> => ({ provider: "fake", externalId: "render-1" }),
    renderReels: async (): Promise<RenderHandle> => ({ provider: "fake", externalId: "render-2" }),
    getRenderStatus: async (): Promise<RenderStatusResult> => ({
      status: "DONE",
      providerStatus: "done",
      outputUrl: "https://example.com/out.mp4",
      message: null
    })
  };
}

describe("RenderProvider contract", () => {
  it("defines exactly the output kinds and statuses the rest of the system relies on", () => {
    expect(RENDER_OUTPUT_KINDS).toEqual(["LANDSCAPE", "REELS"]);
    expect(RENDER_STATUSES).toEqual(["QUEUED", "PROCESSING", "DONE", "FAILED"]);
  });

  it("is satisfiable by a minimal object implementing every method", async () => {
    const provider = makeFakeProvider();
    const handle = await provider.renderLandscape({} as SceneMap);
    const status = await provider.getRenderStatus(handle);
    expect(handle.provider).toBe("fake");
    expect(status.status).toBe("DONE");
  });
});
