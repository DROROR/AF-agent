import type { ReactElement } from "react";
import type { AssetDto } from "@dyo/schemas";
import { assetFileUrl } from "../../lib/projects-api-client";

/**
 * A file as a small picture, whatever it is (2026-10-07): a still image as
 * itself; a video as its first frame, drawn by the browser from the file
 * (`preload="metadata"`, never playing, no sound); anything else as nothing,
 * so the caller names it instead. A video card used to show only a word.
 */
export function AssetThumb({ asset, className, alt = "" }: { asset: AssetDto; className?: string; alt?: string }): ReactElement | null {
  const src = assetFileUrl(asset.projectId, asset.id);
  if (asset.mimeType.startsWith("image/")) {
    return <img src={src} alt={alt} className={className} />;
  }
  if (asset.mimeType.startsWith("video/")) {
    return <video src={`${src}#t=0.1`} className={className} muted playsInline preload="metadata" aria-label={alt} />;
  }
  return null;
}
