import { describe, expect, it } from "vitest";
import type { SceneMap } from "../../scene-map/scene-map.js";
import { DYO_REQUIRED_HEBREW_TEXT } from "../../scene-map/validate-scene-map.js";
import { buildShotstackEditPayload } from "./shotstack-payload.js";

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
      phonePosition: "CENTER",
      assets: [
        { placeholderId: "logo", assetType: "LOGO", sourceUrl: "https://example.com/logo.png" },
        { placeholderId: "hero-image", assetType: "IMAGE", sourceUrl: "https://example.com/hero.png" },
        { placeholderId: "hero-video", assetType: "VIDEO", sourceUrl: "https://example.com/hero.mp4" }
      ],
      texts: [{ placeholderId: "headline", content: DYO_REQUIRED_HEBREW_TEXT, color: "#FFFFFF" }],
      transitionIn: { type: "FADE", durationMs: 300 },
      transitionOut: { type: "NONE" }
    }
  ]
};

describe("buildShotstackEditPayload", () => {
  it("sets the timeline background to the scene map's brand color", () => {
    const payload = buildShotstackEditPayload(sceneMap, "LANDSCAPE");
    expect(payload.timeline.background).toBe("#0057FF");
  });

  it("produces the 1920x1080 landscape output size", () => {
    const payload = buildShotstackEditPayload(sceneMap, "LANDSCAPE");
    expect(payload.output.size).toEqual({ width: 1920, height: 1080 });
  });

  it("produces the native 1080x1920 reels output size", () => {
    const payload = buildShotstackEditPayload(sceneMap, "REELS");
    expect(payload.output.size).toEqual({ width: 1080, height: 1920 });
  });

  it("maps image and video assets onto image/video clips with timing from the scene", () => {
    const payload = buildShotstackEditPayload(sceneMap, "LANDSCAPE");
    const assetClips = payload.timeline.tracks[0]?.clips ?? [];
    expect(assetClips).toHaveLength(3);
    expect(assetClips.map((clip) => clip.asset.type)).toEqual(["image", "image", "video"]);
    expect(assetClips[0]?.start).toBe(0);
    expect(assetClips[0]?.length).toBe(3);
  });

  it("positions the logo clip top-right regardless of the scene's phone position", () => {
    const payload = buildShotstackEditPayload(sceneMap, "LANDSCAPE");
    const logoClip = payload.timeline.tracks[0]?.clips[0];
    expect(logoClip?.position).toBe("topRight");
  });

  it("maps a non-logo asset's phone position onto a Shotstack position value", () => {
    const payload = buildShotstackEditPayload(sceneMap, "LANDSCAPE");
    const heroImageClip = payload.timeline.tracks[0]?.clips[1];
    expect(heroImageClip?.position).toBe("center");
  });

  it("maps text assignments onto rich-text clips on a separate track", () => {
    const payload = buildShotstackEditPayload(sceneMap, "LANDSCAPE");
    const textClips = payload.timeline.tracks[1]?.clips ?? [];
    expect(textClips).toHaveLength(1);
    expect(textClips[0]?.asset).toEqual({
      type: "rich-text",
      text: DYO_REQUIRED_HEBREW_TEXT,
      font: { family: "Heebo", color: "#FFFFFF" },
      align: { horizontal: "center", vertical: "middle" }
    });
    // width/height live on the clip, not nested inside asset - live-verified
    // against the real Shotstack sandbox API (an asset-level width/height is
    // rejected as an unknown property).
    expect(textClips[0]?.width).toBe(Math.round(1920 * 0.8));
    expect(textClips[0]?.height).toBe(300);
  });

  it("registers custom font URLs in timeline.fonts when provided", () => {
    const payload = buildShotstackEditPayload(sceneMap, "LANDSCAPE", {
      fontUrls: ["https://example.com/Heebo.ttf"]
    });
    expect(payload.timeline.fonts).toEqual([{ src: "https://example.com/Heebo.ttf" }]);
  });

  it("omits timeline.fonts entirely when no font URLs are provided", () => {
    const payload = buildShotstackEditPayload(sceneMap, "LANDSCAPE");
    expect(payload.timeline.fonts).toBeUndefined();
  });

  it("uses a text assignment's own fontFamily/fontWeight instead of the Heebo default when provided", () => {
    const customFontSceneMap: SceneMap = {
      ...sceneMap,
      scenes: [
        {
          ...sceneMap.scenes[0]!,
          texts: [
            { placeholderId: "headline", content: "DYO App", fontFamily: "Roboto", fontWeight: 700 }
          ]
        }
      ]
    };
    const payload = buildShotstackEditPayload(customFontSceneMap, "LANDSCAPE");
    const textClip = payload.timeline.tracks[1]?.clips[0];
    expect(textClip?.asset.font).toEqual({ family: "Roboto", weight: 700 });
  });

  it('maps a FADE transition to "fade" and NONE to no transition value', () => {
    const payload = buildShotstackEditPayload(sceneMap, "LANDSCAPE");
    const logoClip = payload.timeline.tracks[0]?.clips[0];
    expect(logoClip?.transition?.in).toBe("fade");
    expect(logoClip?.transition?.out).toBeUndefined();
  });

  it("stacks multiple simultaneous text lines with distinct vertical offsets instead of overlapping", () => {
    const multiLineSceneMap: SceneMap = {
      ...sceneMap,
      scenes: [
        {
          ...sceneMap.scenes[0]!,
          texts: [
            { placeholderId: "line-1", content: DYO_REQUIRED_HEBREW_TEXT },
            { placeholderId: "line-2", content: "שורה שנייה" },
            { placeholderId: "line-3", content: "DYO App" }
          ]
        }
      ]
    };
    const payload = buildShotstackEditPayload(multiLineSceneMap, "REELS");
    const textClips = payload.timeline.tracks[1]?.clips ?? [];
    const offsets = textClips.map((clip) => clip.offset?.y);
    // The middle line's offset is exactly 0, so no `offset` key is emitted at all - equivalent to an explicit 0.
    expect(offsets).toEqual([-0.18, undefined, 0.18]);
  });

  it("does not add an offset for a single text line in a scene", () => {
    const payload = buildShotstackEditPayload(sceneMap, "LANDSCAPE");
    const textClip = payload.timeline.tracks[1]?.clips[0];
    expect(textClip?.offset).toBeUndefined();
  });

  it("omits a track entirely rather than sending an empty clips array (Shotstack rejects empty tracks)", () => {
    const textOnlySceneMap: SceneMap = {
      projectId: "project-2",
      brandColor: "#000000",
      scenes: [
        {
          sceneId: "scene-1",
          label: "Text only",
          startMs: 0,
          durationMs: 5000,
          assets: [],
          texts: [{ placeholderId: "line-1", content: "Hello" }]
        }
      ]
    };
    const payload = buildShotstackEditPayload(textOnlySceneMap, "REELS");
    expect(payload.timeline.tracks).toHaveLength(1);
    expect(payload.timeline.tracks[0]?.clips).toHaveLength(1);
  });

  it("omits the text track entirely when a scene map has no text assignments", () => {
    const assetOnlySceneMap: SceneMap = {
      projectId: "project-3",
      brandColor: "#000000",
      scenes: [
        {
          sceneId: "scene-1",
          label: "Asset only",
          startMs: 0,
          durationMs: 5000,
          assets: [{ placeholderId: "hero", assetType: "IMAGE", sourceUrl: "https://example.com/hero.png" }],
          texts: []
        }
      ]
    };
    const payload = buildShotstackEditPayload(assetOnlySceneMap, "REELS");
    expect(payload.timeline.tracks).toHaveLength(1);
    expect(payload.timeline.tracks[0]?.clips).toHaveLength(1);
  });

  it("sets a video asset's trim from trimSeconds, and omits trim for images", () => {
    const sceneMapWithTrim: SceneMap = {
      projectId: "project-4",
      brandColor: "#000000",
      scenes: [
        {
          sceneId: "scene-1",
          label: "Trimmed video",
          startMs: 0,
          durationMs: 4000,
          assets: [
            { placeholderId: "video", assetType: "VIDEO", sourceUrl: "https://example.com/a.mp4", trimSeconds: 36 },
            { placeholderId: "image", assetType: "IMAGE", sourceUrl: "https://example.com/a.png", trimSeconds: 5 }
          ],
          texts: []
        }
      ]
    };
    const payload = buildShotstackEditPayload(sceneMapWithTrim, "LANDSCAPE");
    const clips = payload.timeline.tracks[0]?.clips ?? [];
    expect(clips[0]?.asset.trim).toBe(36);
    expect(clips[1]?.asset.trim).toBeUndefined();
  });

  it("positions two simultaneous assets in one scene at distinct offsets (side-by-side phones)", () => {
    const twoPhoneSceneMap: SceneMap = {
      projectId: "project-5",
      brandColor: "#000000",
      scenes: [
        {
          sceneId: "scene-6",
          label: "Two phones",
          startMs: 0,
          durationMs: 5000,
          assets: [
            {
              placeholderId: "left-phone",
              assetType: "VIDEO",
              sourceUrl: "https://example.com/left.mp4",
              offsetX: -0.25
            },
            {
              placeholderId: "right-phone",
              assetType: "VIDEO",
              sourceUrl: "https://example.com/right.mp4",
              offsetX: 0.25
            }
          ],
          texts: []
        }
      ]
    };
    const payload = buildShotstackEditPayload(twoPhoneSceneMap, "LANDSCAPE");
    const clips = payload.timeline.tracks[0]?.clips ?? [];
    expect(clips[0]?.offset).toEqual({ x: -0.25, y: 0 });
    expect(clips[1]?.offset).toEqual({ x: 0.25, y: 0 });
  });
});
