"use client";

import { useState, type ReactElement } from "react";
import { useLocale } from "../LocaleProvider";
import { ErrorState } from "../ErrorState";
import { Skeleton } from "./Skeleton";

/**
 * Client-handoff phase, section N ("First Preview Player / Image") - a
 * real HTML5 video player for an authenticated render-artifact byte
 * stream (never a fake placeholder when a real artifact exists). Native
 * `controls` already provides play/pause, seek, volume, and fullscreen
 * (where the browser supports it) without a third-party player library.
 * `src` must always be a same-origin, authenticated API route (see
 * renderArtifactFileUrl in projects-api-client.ts) - never a raw
 * filesystem/Worker-local path.
 */
export function VideoArtifactPlayer({ src, ariaLabel }: { src: string; ariaLabel: string }): ReactElement {
  const { t } = useLocale();
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return <ErrorState title={t.renders.playerErrorTitle} description={t.renders.playerErrorDescription} />;
  }

  return (
    <div className="video-artifact-player">
      {isLoading ? <Skeleton height="200px" /> : null}
      <video
        className="video-artifact-player__video"
        style={isLoading ? { display: "none" } : undefined}
        src={src}
        controls
        preload="metadata"
        aria-label={ariaLabel}
        onLoadedData={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
      >
        <track kind="captions" />
      </video>
    </div>
  );
}
