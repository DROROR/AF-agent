import type { RenderOutputKind } from "../../contract/render-provider.js";
import type { PhonePosition, Scene, SceneMap, Transition } from "../../scene-map/scene-map.js";

/**
 * Shotstack Edit API JSON shapes - only the fields this POC actually uses.
 * Field names confirmed against Shotstack's own current API docs
 * (https://shotstack.io/docs/api/ and the full-text reference), not guessed.
 * Text uses the "rich-text" asset type, not the older "title" asset - see
 * docs/SHOTSTACK-POC.md "Typography smoke test" for why.
 */
export interface ShotstackTextFont {
  family: string;
  size?: number;
  weight?: number;
  color?: string;
}

export interface ShotstackTextAlign {
  horizontal?: "left" | "center" | "right";
  vertical?: "top" | "middle" | "bottom";
}

export interface ShotstackAsset {
  type: "image" | "video" | "rich-text";
  src?: string;
  text?: string;
  font?: ShotstackTextFont;
  align?: ShotstackTextAlign;
}

export interface ShotstackClip {
  asset: ShotstackAsset;
  start: number;
  length: number;
  /** Live-verified against the real Shotstack sandbox API: width/height belong on the clip, not nested inside `asset` (a "rich-text" asset with `width`/`height` is rejected as an unknown property). */
  width?: number;
  height?: number;
  position?: string;
  offset?: { x: number; y: number };
  transition?: { in?: string; out?: string };
}

export interface ShotstackTrack {
  clips: ShotstackClip[];
}

export interface ShotstackFont {
  src: string;
}

export interface ShotstackTimeline {
  background: string;
  /** Custom fonts (e.g. Heebo) must be registered here - Shotstack does not ship them as standard fonts. Referenced from a clip via asset.font.family. */
  fonts?: ShotstackFont[];
  tracks: ShotstackTrack[];
}

export interface ShotstackOutput {
  format: "mp4";
  size: { width: number; height: number };
}

export interface ShotstackEditPayload {
  timeline: ShotstackTimeline;
  output: ShotstackOutput;
}

const OUTPUT_SIZES: Record<RenderOutputKind, { width: number; height: number }> = {
  // 1920x1080/1080x1920 per CLAUDE.md's own required output resolutions.
  LANDSCAPE: { width: 1920, height: 1080 },
  REELS: { width: 1080, height: 1920 }
};

/** Only "fade" is used - the most universally supported Shotstack transition value; see docs/SHOTSTACK-POC.md for why more exotic transition types were not risked without live verification. */
function toShotstackTransition(transition: Transition | undefined): string | undefined {
  if (!transition || transition.type === "NONE") {
    return undefined;
  }
  return "fade";
}

const PHONE_POSITION_TO_SHOTSTACK_POSITION: Record<PhonePosition, string> = {
  LEFT: "centerLeft",
  CENTER: "center",
  RIGHT: "centerRight",
  FULL_SCREEN: "center"
};

function assetClips(scene: Scene): ShotstackClip[] {
  return scene.assets.map((asset) => {
    const isLogo = asset.assetType === "LOGO";
    const position = isLogo
      ? "topRight"
      : scene.phonePosition
        ? PHONE_POSITION_TO_SHOTSTACK_POSITION[scene.phonePosition]
        : undefined;
    const transitionIn = toShotstackTransition(scene.transitionIn);
    const transitionOut = toShotstackTransition(scene.transitionOut);

    return {
      asset: {
        type: asset.assetType === "VIDEO" ? "video" : "image",
        src: asset.sourceUrl
      },
      start: scene.startMs / 1000,
      length: scene.durationMs / 1000,
      ...(position ? { position } : {}),
      ...(transitionIn || transitionOut
        ? { transition: { ...(transitionIn ? { in: transitionIn } : {}), ...(transitionOut ? { out: transitionOut } : {}) } }
        : {})
    };
  });
}

/** DYO's required brand font (docs/CLIENT_WORKER_PREFLIGHT.md checks for Heebo on the Windows worker) - used as the default when a text assignment doesn't specify its own fontFamily. Must be registered via `options.fontUrls` for this to actually load - see docs/SHOTSTACK-POC.md. */
const DEFAULT_FONT_FAMILY = "Heebo";

/** Fraction of frame height between stacked lines (Shotstack's `offset` unit is normalized -1..1 - confirmed against Shotstack's own docs, not guessed) - keeps multiple simultaneous text assignments in one scene from rendering on top of each other. */
const LINE_SPACING_FRACTION = 0.18;

function textClips(scene: Scene, outputSize: { width: number; height: number }): ShotstackClip[] {
  const count = scene.texts.length;
  return scene.texts.map((text, index) => {
    const offsetY = count > 1 ? (index - (count - 1) / 2) * LINE_SPACING_FRACTION : 0;
    return {
      asset: {
        type: "rich-text",
        text: text.content,
        font: {
          family: text.fontFamily ?? DEFAULT_FONT_FAMILY,
          ...(text.fontWeight ? { weight: text.fontWeight } : {}),
          ...(text.color ? { color: text.color } : {})
        },
        align: { horizontal: "center", vertical: "middle" }
      },
      start: scene.startMs / 1000,
      length: scene.durationMs / 1000,
      width: Math.round(outputSize.width * 0.8),
      height: 300,
      position: "center",
      ...(offsetY !== 0 ? { offset: { x: 0, y: offsetY } } : {})
    };
  });
}

export interface BuildShotstackEditPayloadOptions {
  /**
   * Public URLs for any custom font (e.g. Heebo) referenced by a text
   * assignment's fontFamily/DEFAULT_FONT_FAMILY - required because Shotstack
   * does not ship Heebo as a standard font (docs/SHOTSTACK-POC.md).
   */
  fontUrls?: string[];
}

/**
 * Pure translation from our provider-neutral SceneMap into a Shotstack Edit
 * API request body. Covers: image asset, video asset, text, logo,
 * background/brand color, positioning, timing, transitions, and both
 * required output sizes - CLAUDE.md Phase 4 (paused) Step 2's POC checklist.
 */
export function buildShotstackEditPayload(
  sceneMap: SceneMap,
  outputKind: RenderOutputKind,
  options: BuildShotstackEditPayloadOptions = {}
): ShotstackEditPayload {
  const outputSize = OUTPUT_SIZES[outputKind];
  const assetClipList = sceneMap.scenes.flatMap(assetClips);
  const textClipList = sceneMap.scenes.flatMap((scene) => textClips(scene, outputSize));
  // Live-verified against the real Shotstack sandbox API: a track with zero
  // clips is rejected ("Too small: expected array to have >=1 items"), so a
  // scene map with no assets (or no text) must not produce an empty track.
  const tracks: ShotstackTrack[] = [
    ...(assetClipList.length > 0 ? [{ clips: assetClipList }] : []),
    ...(textClipList.length > 0 ? [{ clips: textClipList }] : [])
  ];

  return {
    timeline: {
      background: sceneMap.brandColor,
      ...(options.fontUrls && options.fontUrls.length > 0
        ? { fonts: options.fontUrls.map((src) => ({ src })) }
        : {}),
      tracks
    },
    output: {
      format: "mp4",
      size: OUTPUT_SIZES[outputKind]
    }
  };
}
