"use client";

import { useCallback, useEffect, useState } from "react";
import type { ExecutionPlanEditOperation, ExecutionPlanResponse, ProjectResponse } from "@dyo/schemas";
import {
  approveExecutionPlan,
  fetchExecutionPlan,
  fetchProjectDetail,
  rejectExecutionPlan,
  reopenExecutionPlan,
  updateExecutionPlan,
  type ApiResult
} from "./projects-api-client";

export interface MutationOutcome {
  ok: boolean;
  message?: string;
}

export interface ProjectWorkspaceState {
  project: ProjectResponse | null;
  plan: ExecutionPlanResponse | null;
  isLoading: boolean;
  /** A load failure - distinct from `isStale` below, which is a mutation-time conflict, not a load failure. */
  error: string | null;
  /**
   * Set only after a mutation is refused specifically for a stale
   * baseRevision (409 CONFLICT) - the correct recovery is reloading the
   * plan (refetch), never silently retrying the same edit against a
   * revision that has already moved on.
   */
  isStale: boolean;
  refetch: () => Promise<void>;
  applyEdit: (operations: ExecutionPlanEditOperation[]) => Promise<MutationOutcome>;
  approve: () => Promise<MutationOutcome>;
  reject: () => Promise<MutationOutcome>;
  reopen: () => Promise<MutationOutcome>;
}

type PlanTransition = (projectId: string, baseRevision: number) => Promise<ApiResult<ExecutionPlanResponse>>;

/**
 * Loads one real project's detail + current execution plan once on mount,
 * and exposes the real Phase 6 edit/approve/reject/reopen mutations. Never
 * polls (unlike useDashboardStatus) - this is an on-demand workspace, not a
 * live health monitor; state is refreshed explicitly after each successful
 * mutation using the revision the API itself returned, and `refetch` is
 * exposed for the stale-revision recovery path.
 */
export function useProjectWorkspace(projectId: string): ProjectWorkspaceState {
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [plan, setPlan] = useState<ExecutionPlanResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  // Every setState call below runs only after the initial `await` (never
  // synchronously at the top of this function) - calling setState
  // synchronously inside an effect-invoked function causes cascading
  // renders and is flagged by react-hooks/set-state-in-effect. `isLoading`
  // already defaults to true for the first mount; refetch() re-running
  // this does not need to flip it back to true first (the previously
  // loaded data stays on screen until the refetch resolves, same pattern
  // as useDashboardStatus's own poll()).
  const load = useCallback(async () => {
    const [projectResult, planResult] = await Promise.all([fetchProjectDetail(projectId), fetchExecutionPlan(projectId)]);
    if (!projectResult.ok) {
      setError(projectResult.message);
      setIsLoading(false);
      return;
    }
    setProject(projectResult.data);
    if (planResult.ok) {
      setPlan(planResult.data);
      setError(null);
    } else if (planResult.status === 404) {
      // A real, valid state: this project has no execution plan yet - not a load error.
      setPlan(null);
      setError(null);
    } else {
      setError(planResult.message);
    }
    setIsStale(false);
    setIsLoading(false);
  }, [projectId]);

  useEffect(() => {
    // load() only calls setState after its own first `await` - this
    // effect just triggers it (same accepted pattern as AppShell.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const applyEdit = useCallback(
    async (operations: ExecutionPlanEditOperation[]): Promise<MutationOutcome> => {
      if (!plan) {
        return { ok: false, message: "No plan loaded yet" };
      }
      const result = await updateExecutionPlan(projectId, plan.plan.revision, operations);
      if (result.ok) {
        setPlan(result.data);
        setIsStale(false);
        return { ok: true };
      }
      if (result.code === "CONFLICT") {
        setIsStale(true);
      }
      return { ok: false, message: result.message };
    },
    [plan, projectId]
  );

  const runTransition = useCallback(
    async (fn: PlanTransition): Promise<MutationOutcome> => {
      if (!plan) {
        return { ok: false, message: "No plan loaded yet" };
      }
      const result = await fn(projectId, plan.plan.revision);
      if (result.ok) {
        setPlan(result.data);
        setIsStale(false);
        return { ok: true };
      }
      if (result.code === "CONFLICT") {
        setIsStale(true);
      }
      return { ok: false, message: result.message };
    },
    [plan, projectId]
  );

  return {
    project,
    plan,
    isLoading,
    error,
    isStale,
    refetch: load,
    applyEdit,
    approve: useCallback(() => runTransition(approveExecutionPlan), [runTransition]),
    reject: useCallback(() => runTransition(rejectExecutionPlan), [runTransition]),
    reopen: useCallback(() => runTransition(reopenExecutionPlan), [runTransition])
  };
}
