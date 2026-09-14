"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExecutionPlanEditOperation,
  ExecutionPlanResponse,
  ProjectResponse,
  RenderOutputVariant,
  SetRenderOutputConfigRequest
} from "@dyo/schemas";
import {
  approveExecutionPlan,
  createExecutionPlan,
  fetchExecutionPlan,
  fetchProjectDetail,
  rejectExecutionPlan,
  reopenExecutionPlan,
  setRenderOutputConfig,
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
  /**
   * Creates the initial DRAFT plan for this project (POST .../execution-plan)
   * - only meaningful while `plan` is null. Never applies Work Map rows and
   * never approves the created plan; it only creates the same deterministic
   * DRAFT create-execution-plan.ts always builds from the manifest, exactly
   * as if the operator had called the API directly.
   */
  createPlan: () => Promise<MutationOutcome>;
  applyEdit: (operations: ExecutionPlanEditOperation[]) => Promise<MutationOutcome>;
  approve: () => Promise<MutationOutcome>;
  /** Approves every included, ready scene (APPROVE_SCENE) and then the plan - what "Approve Scenes" must do so Preview has an executable scene. A second call while one is running is ignored. */
  approveScenes: () => Promise<MutationOutcome>;
  reject: () => Promise<MutationOutcome>;
  reopen: () => Promise<MutationOutcome>;
  setRenderOutput: (variant: RenderOutputVariant, body: SetRenderOutputConfigRequest) => Promise<MutationOutcome>;
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

  // A plain ref, not state: guards against a genuine double-click firing
  // two real network requests before React has re-rendered the caller's
  // own `disabled` state - checked and set synchronously, so a second
  // call arriving before the first one's `await` even starts is refused
  // immediately rather than racing on state that hasn't updated yet.
  const isCreatingPlanRef = useRef(false);

  const createPlan = useCallback(async (): Promise<MutationOutcome> => {
    if (plan) {
      return { ok: false, message: "This project already has an execution plan" };
    }
    if (isCreatingPlanRef.current) {
      return { ok: false, message: "Already creating an execution plan" };
    }
    isCreatingPlanRef.current = true;
    try {
      const result = await createExecutionPlan(projectId);
      if (result.ok) {
        setPlan(result.data);
        setError(null);
        setIsStale(false);
        return { ok: true };
      }
      return { ok: false, message: result.message };
    } finally {
      isCreatingPlanRef.current = false;
    }
  }, [plan, projectId]);

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

  /**
   * "Approve Scenes" (Simple mode). REAL 2026-09-14 DEFECT: this button used
   * to approve only the PLAN. Every included scene stayed READY_FOR_APPROVAL,
   * so the Preview tab (and execute-frame dispatch, which requires
   * approvalState APPROVED) had nothing to execute - "No approved scene to
   * execute" on a plan that showed Approved. It now does what it says: first
   * approves every included, ready scene through the normal APPROVE_SCENE plan
   * edit (a new revision - mappings untouched), then approves the plan at that
   * revision. Also recovers a plan approved by the old flow: scenes still
   * pending approval are approved and the plan re-approved.
   *
   * A second call while one is running is ignored rather than sent - the old
   * double click surfaced a raw "Plan is APPROVED, not DRAFT" 409.
   */
  const isApprovingScenesRef = useRef(false);
  const approveScenes = useCallback(async (): Promise<MutationOutcome> => {
    if (!plan) {
      return { ok: false, message: "No plan loaded yet" };
    }
    if (isApprovingScenesRef.current) {
      return { ok: true };
    }
    isApprovingScenesRef.current = true;
    try {
      let current = plan;
      const pendingScenes = current.plan.scenePlans.filter(
        (scene) => scene.use && scene.approvalState === "READY_FOR_APPROVAL" && scene.unresolvedReasons.length === 0
      );
      if (pendingScenes.length > 0) {
        const edited = await updateExecutionPlan(
          projectId,
          current.plan.revision,
          pendingScenes.map((scene) => ({ type: "APPROVE_SCENE" as const, scenePlanId: scene.id }))
        );
        if (!edited.ok) {
          if (edited.code === "CONFLICT") {
            setIsStale(true);
          }
          return { ok: false, message: edited.message };
        }
        current = edited.data;
        setPlan(edited.data);
      }
      if (current.plan.status !== "APPROVED") {
        const approved = await approveExecutionPlan(projectId, current.plan.revision);
        if (!approved.ok) {
          if (approved.code === "CONFLICT") {
            setIsStale(true);
          }
          return { ok: false, message: approved.message };
        }
        setPlan(approved.data);
      }
      setIsStale(false);
      return { ok: true };
    } finally {
      isApprovingScenesRef.current = false;
    }
  }, [plan, projectId]);

  const setRenderOutput = useCallback(
    async (variant: RenderOutputVariant, body: SetRenderOutputConfigRequest): Promise<MutationOutcome> => {
      const result = await setRenderOutputConfig(projectId, variant, body);
      if (result.ok) {
        setPlan(result.data);
        return { ok: true };
      }
      return { ok: false, message: result.message };
    },
    [projectId]
  );

  return {
    project,
    plan,
    isLoading,
    error,
    isStale,
    refetch: load,
    createPlan,
    applyEdit,
    approve: useCallback(() => runTransition(approveExecutionPlan), [runTransition]),
    approveScenes,
    reject: useCallback(() => runTransition(rejectExecutionPlan), [runTransition]),
    reopen: useCallback(() => runTransition(reopenExecutionPlan), [runTransition]),
    setRenderOutput
  };
}
