"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlanStatus } from "@dyo/schemas";
import { fetchExecutionPlan, fetchProjectDetail, fetchProjectList } from "./projects-api-client";

export interface ProjectListItem {
  projectId: string;
  name: string;
  sourceFileName: string | null;
  sourceShaAbbrev: string | null;
  planStatus: PlanStatus | null;
  planRevision: number | null;
  sceneCount: number | null;
  unresolvedCount: number | null;
  updatedAt: string;
}

export interface UseProjectsListResult {
  items: ProjectListItem[] | null;
  isLoading: boolean;
  error: string | null;
}

function sha256Abbrev(sha256: string): string {
  return sha256.slice(0, 12);
}

/**
 * Enriches the real project list with each project's manifest (source
 * filename, scene count fallback) and current execution plan (status,
 * revision, unresolved count) - GET /api/projects only returns the bare
 * ProjectDto (see project.ts), so this composes the real, already-existing
 * per-project endpoints rather than inventing a new aggregate one for
 * what is currently a single-digit project count. A per-project
 * detail/plan fetch failure never fails the whole list - the affected
 * fields just render as unavailable ("—"), matching "do not invent
 * values, show a clean not-available state for missing data".
 */
export function useProjectsList(): UseProjectsListResult {
  const [items, setItems] = useState<ProjectListItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // No setState before the first `await` - see use-project-workspace.ts's
  // load() for why (react-hooks/set-state-in-effect).
  const load = useCallback(async () => {
    const listResult = await fetchProjectList();
    if (!listResult.ok) {
      setError(listResult.message);
      setIsLoading(false);
      return;
    }

    const enriched = await Promise.all(
      listResult.data.map(async (project): Promise<ProjectListItem> => {
        const [detailResult, planResult] = await Promise.all([
          fetchProjectDetail(project.projectId),
          fetchExecutionPlan(project.projectId)
        ]);
        const manifest = detailResult.ok ? detailResult.data.manifest : null;
        const plan = planResult.ok ? planResult.data.plan : null;
        return {
          projectId: project.projectId,
          name: project.name,
          sourceFileName: manifest?.sourceProject.name ?? null,
          sourceShaAbbrev: sha256Abbrev(project.sourceProjectSha256),
          planStatus: plan?.status ?? null,
          planRevision: plan?.revision ?? null,
          sceneCount: plan ? plan.scenePlans.length : (manifest?.scenes.length ?? null),
          unresolvedCount: plan ? plan.scenePlans.filter((scene) => scene.unresolvedReasons.length > 0).length : null,
          updatedAt: project.updatedAt
        };
      })
    );

    setItems(enriched);
    setError(null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // load() only calls setState after its own first `await` - this
    // effect just triggers it (same accepted pattern as AppShell.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return { items, isLoading, error };
}
