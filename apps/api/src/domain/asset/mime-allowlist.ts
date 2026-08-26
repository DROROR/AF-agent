import type { MediaKind } from "@dyo/schemas";

export interface MimeAllowlistEntry {
  mediaKind: Exclude<MediaKind, "LOGO" | "OTHER">;
  /** Fixed extension used for the STORED filename - never derived from the client's original filename (CLAUDE.md-adjacent rule for this phase: never trust the original filename as a path/identity fact). */
  extension: string;
}

/**
 * Every MIME type this system accepts for upload. Deliberately excludes
 * `image/svg+xml` - an SVG can embed executable script content, and
 * section 3's "no executable/script uploads" rules it out even though
 * it is nominally an image format. Anything not listed here is refused
 * outright (415), never silently bucketed into a generic OTHER kind.
 */
export const MIME_ALLOWLIST: Readonly<Record<string, MimeAllowlistEntry>> = {
  "image/png": { mediaKind: "IMAGE", extension: "png" },
  "image/jpeg": { mediaKind: "IMAGE", extension: "jpg" },
  "image/webp": { mediaKind: "IMAGE", extension: "webp" },
  "video/mp4": { mediaKind: "VIDEO", extension: "mp4" },
  "video/quicktime": { mediaKind: "VIDEO", extension: "mov" },
  "video/webm": { mediaKind: "VIDEO", extension: "webm" },
  "audio/mpeg": { mediaKind: "AUDIO", extension: "mp3" },
  "audio/wav": { mediaKind: "AUDIO", extension: "wav" },
  "application/pdf": { mediaKind: "DOCUMENT", extension: "pdf" }
};

export type ResolveMediaKindResult = { ok: true; mediaKind: MediaKind } | { ok: false; reason: string };

/**
 * `requestedKind` is an optional, explicit user label at upload time -
 * the ONLY semantic override this system ever accepts, and only for the
 * one case a human can genuinely know that a machine cannot: "this image
 * is our logo." Every other requested kind must match the MIME-derived
 * one exactly, or the upload is refused - never silently coerced.
 */
export function resolveMediaKindForUpload(mimeType: string, requestedKind: MediaKind | null): ResolveMediaKindResult {
  const entry = MIME_ALLOWLIST[mimeType.toLowerCase()];
  if (!entry) {
    return { ok: false, reason: `Unsupported file type: ${mimeType}` };
  }
  if (requestedKind === null || requestedKind === entry.mediaKind) {
    return { ok: true, mediaKind: entry.mediaKind };
  }
  if (requestedKind === "LOGO" && entry.mediaKind === "IMAGE") {
    return { ok: true, mediaKind: "LOGO" };
  }
  return { ok: false, reason: `Requested mediaKind ${requestedKind} is not valid for a ${mimeType} file` };
}

export function extensionForMime(mimeType: string): string | null {
  return MIME_ALLOWLIST[mimeType.toLowerCase()]?.extension ?? null;
}
