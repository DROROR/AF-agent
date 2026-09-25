"use client";

import { useEffect, useState } from "react";
import type { ExecutionSessionDto, RenderArtifactDto, WorkMap } from "@dyo/schemas";
import { fetchCurrentExecutionSession, fetchRenderArtifacts, fetchWorkMap } from "./projects-api-client";

export interface ProjectStepperStatus {
  workMap: WorkMap | null;
  session: ExecutionSessionDto | null;
  renderArtifacts: RenderArtifactDto[] | null;
  isLoading: boolean;
  /**
   * REAL 2026-09-25 INCIDENT follow-up ("never invent state"): a failed
   * fetch used to be flattened into the same `null` a genuinely absent
   * work map / session / render list produces, so a transient API failure
   * silently rendered as "this project has not started yet" - and the
   * guidance built on top would then confidently name the WRONG next
   * action. Loading and "could not load" are now distinguishable from
   * "really is absent"; callers that make claims about where a project is
   * must treat this as "we cannot tell" and say so.
   */
  hasError: boolean;
}

/**
 * The extra real state the global workflow stepper needs (client-handoff
 * phase, section B) that ProjectWorkspaceProvider does not already load
 * (which only fetches project + execution plan) - a separate, on-demand
 * fetch rather than widening that shared hook, so every other project
 * page's own load stays exactly as fast/minimal as it already is. A
 * failed fetch here never blocks the page or shows an error banner, but it
 * is NOT silently equivalent to "there is none yet" - see `hasError`.
 */
export function useProjectStepperStatus(projectId: string): ProjectStepperStatus {
  const [workMap, setWorkMap] = useState<WorkMap | null>(null);
  const [session, setSession] = useState<ExecutionSessionDto | null>(null);
  const [renderArtifacts, setRenderArtifacts] = useState<RenderArtifactDto[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

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
      // A 200 carrying `null`/`[]` is a real answer ("there is none yet").
      // Only a genuine transport/contract failure is unknown-ness.
      setHasError(!workMapResult.ok || !sessionResult.ok || !artifactsResult.ok);
      setIsLoading(false);
    }

    // load() only calls setState after its own first `await` - same
    // accepted pattern as use-project-workspace.ts's own effect.
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { workMap, session, renderArtifacts, isLoading, hasError };
}
