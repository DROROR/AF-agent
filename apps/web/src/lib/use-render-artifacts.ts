"use client";

import { useCallback, useEffect, useState } from "react";
import type { RenderArtifactDto } from "@dyo/schemas";
import { fetchRenderArtifacts } from "./projects-api-client";

export interface RenderArtifactsState {
  artifacts: RenderArtifactDto[] | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Real, persisted render-artifact metadata for one project (render-delivery
 * phase section 7) - fetched only by the Renders page, for one already-
 * selected project. The caller mounts this behind a `key={projectId}` when
 * the user switches projects (see RendersPage.tsx) so state resets via
 * fresh initial useState values instead of an explicit reset branch here -
 * same "no synchronous setState in an effect body" constraint as
 * use-project-assets.ts's own effect.
 */
export function useRenderArtifacts(projectId: string): RenderArtifactsState {
  const [artifacts, setArtifacts] = useState<RenderArtifactDto[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchRenderArtifacts(projectId);
    if (result.ok) {
      setArtifacts(result.data);
      setError(null);
    } else {
      setArtifacts(null);
      setError(result.message);
    }
    setIsLoading(false);
  }, [projectId]);

  useEffect(() => {
    // load() only calls setState after its own first `await` - same
    // accepted pattern as use-project-assets.ts's own effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return { artifacts, isLoading, error };
}
