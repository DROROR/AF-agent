"use client";

import { useEffect, useState } from "react";
import type { ExecutionSessionDto, RenderArtifactDto, WorkMap } from "@dyo/schemas";
import { fetchCurrentExecutionSession, fetchRenderArtifacts, fetchWorkMap } from "./projects-api-client";

export interface ProjectStepperStatus {
  workMap: WorkMap | null;
  session: ExecutionSessionDto | null;
  renderArtifacts: RenderArtifactDto[] | null;
  isLoading: boolean;
}

/**
 * The extra real state the global workflow stepper needs (client-handoff
 * phase, section B) that ProjectWorkspaceProvider does not already load
 * (which only fetches project + execution plan) - a separate, on-demand
 * fetch rather than widening that shared hook, so every other project
 * page's own load stays exactly as fast/minimal as it already is. A
 * failed fetch here degrades to null (never blocks the page or shows an
 * error banner) - the stepper simply treats that signal as "not yet
 * known", same as a project with no work map/session/renders at all.
 */
export function useProjectStepperStatus(projectId: string): ProjectStepperStatus {
  const [workMap, setWorkMap] = useState<WorkMap | null>(null);
  const [session, setSession] = useState<ExecutionSessionDto | null>(null);
  const [renderArtifacts, setRenderArtifacts] = useState<RenderArtifactDto[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      const [workMapResult, sessionResult, artifactsResult] = await Promise.all([
        fetchWorkMap(projectId),
        fetchCurrentExecutionSession(projectId),
        fetchRenderArtifacts(projectId)
      ]);
      if (cancelled) {
        return;
      }
      setWorkMap(workMapResult.ok ? workMapResult.data : null);
      setSession(sessionResult.ok ? sessionResult.data : null);
      setRenderArtifacts(artifactsResult.ok ? artifactsResult.data : null);
      setIsLoading(false);
    }

    // load() only calls setState after its own first `await` - same
    // accepted pattern as use-project-workspace.ts's own effect.
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { workMap, session, renderArtifacts, isLoading };
}
