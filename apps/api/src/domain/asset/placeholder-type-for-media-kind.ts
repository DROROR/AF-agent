import type { MediaKind, PlaceholderType } from "@dyo/schemas";

/**
 * The closest real placeholderType a MAP_ASSET operation requires, given
 * a real asset's own mediaKind - never a fabricated visual type for a
 * non-visual kind (AUDIO/DOCUMENT/OTHER honestly become "unknown" rather
 * than image/video/logo). Shared by both the manual Scene Mapping asset
 * picker's write path and the Mapping Assistant's accept-suggestion flow,
 * so the two never silently disagree on this mapping.
 */
export function placeholderTypeForMediaKind(mediaKind: MediaKind): PlaceholderType {
  switch (mediaKind) {
    case "IMAGE":
      return "image";
    case "VIDEO":
      return "video";
    case "LOGO":
      return "logo";
    default:
      return "unknown";
  }
}
