import { describe, expect, it } from "vitest";
import type { SceneMap } from "./scene-map.js";
import { DYO_REQUIRED_HEBREW_TEXT, validateSceneMap } from "./validate-scene-map.js";

function sceneMap(overrides: Partial<SceneMap> = {}): SceneMap {
  return {
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
        texts: [{ placeholderId: "t1", content: `${DYO_REQUIRED_HEBREW_TEXT}` }]
      }
    ],
    ...overrides
  };
}

describe("validateSceneMap", () => {
  it("passes for a scene map with a logo and the required Hebrew text", () => {
    const result = validateSceneMap(sceneMap());
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("fails when no logo is present anywhere (top-level or as a scene asset)", () => {
    const result = validateSceneMap(sceneMap({ logoAssetUrl: undefined }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("logo"))).toBe(true);
  });

  it("accepts a logo provided as a scene asset instead of the top-level field", () => {
    const result = validateSceneMap(
      sceneMap({
        logoAssetUrl: undefined,
        scenes: [
          {
            sceneId: "scene-1",
            label: "Opening",
            startMs: 0,
            durationMs: 3000,
            assets: [{ placeholderId: "logo", assetType: "LOGO", sourceUrl: "https://example.com/logo.png" }],
            texts: [{ placeholderId: "t1", content: DYO_REQUIRED_HEBREW_TEXT }]
          }
        ]
      })
    );
    expect(result.valid).toBe(true);
  });

  it("fails when the required DYO Hebrew text is missing from every scene", () => {
    const result = validateSceneMap(
      sceneMap({ scenes: [{ sceneId: "scene-1", label: "Opening", startMs: 0, durationMs: 3000, assets: [], texts: [] }] })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes(DYO_REQUIRED_HEBREW_TEXT))).toBe(true);
  });

  it("fails when a scene has a non-positive duration", () => {
    const result = validateSceneMap(
      sceneMap({
        scenes: [
          {
            sceneId: "scene-1",
            label: "Opening",
            startMs: 0,
            durationMs: 0,
            assets: [],
            texts: [{ placeholderId: "t1", content: DYO_REQUIRED_HEBREW_TEXT }]
          }
        ]
      })
    );
    expect(result.valid).toBe(false);
  });

  it("fails when there are no scenes at all", () => {
    const result = validateSceneMap(sceneMap({ scenes: [] }));
    expect(result.valid).toBe(false);
  });

  it("reports every violated rule at once rather than stopping at the first", () => {
    const result = validateSceneMap(
      sceneMap({
        logoAssetUrl: undefined,
        scenes: [{ sceneId: "scene-1", label: "Opening", startMs: 0, durationMs: 0, assets: [], texts: [] }]
      })
    );
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
