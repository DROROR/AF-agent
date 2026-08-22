import { describe, expect, it } from "vitest";
import { sceneMapSchema } from "./scene-map.js";

function validScene(overrides: Record<string, unknown> = {}) {
  return {
    sceneId: "scene-1",
    label: "Opening",
    startMs: 0,
    durationMs: 3000,
    assets: [],
    texts: [],
    ...overrides
  };
}

function validSceneMap(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "project-1",
    brandColor: "#0057FF",
    scenes: [validScene()],
    ...overrides
  };
}

describe("sceneMapSchema", () => {
  it("accepts a minimal valid scene map", () => {
    expect(sceneMapSchema.safeParse(validSceneMap()).success).toBe(true);
  });

  it("rejects a scene map with zero scenes", () => {
    expect(sceneMapSchema.safeParse(validSceneMap({ scenes: [] })).success).toBe(false);
  });

  it("rejects a scene with a non-positive duration", () => {
    const result = sceneMapSchema.safeParse(
      validSceneMap({ scenes: [validScene({ durationMs: 0 })] })
    );
    expect(result.success).toBe(false);
  });

  it("rejects an asset assignment with an invalid asset type", () => {
    const result = sceneMapSchema.safeParse(
      validSceneMap({
        scenes: [
          validScene({
            assets: [{ placeholderId: "p1", assetType: "AUDIO", sourceUrl: "https://example.com/a.png" }]
          })
        ]
      })
    );
    expect(result.success).toBe(false);
  });

  it("accepts a fully populated scene with assets, text, phone position and transitions", () => {
    const result = sceneMapSchema.safeParse(
      validSceneMap({
        logoAssetUrl: "https://example.com/logo.png",
        scenes: [
          validScene({
            assets: [
              { placeholderId: "p1", assetType: "IMAGE", sourceUrl: "https://example.com/a.png" },
              { placeholderId: "p2", assetType: "VIDEO", sourceUrl: "https://example.com/b.mp4" }
            ],
            texts: [{ placeholderId: "t1", content: "Hello", color: "#FFFFFF" }],
            phonePosition: "CENTER",
            transitionIn: { type: "FADE", durationMs: 300 },
            transitionOut: { type: "NONE" }
          })
        ]
      })
    );
    expect(result.success).toBe(true);
  });
});
