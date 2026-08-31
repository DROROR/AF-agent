/**
 * Client-handoff phase, section B/C ("Global step-by-step progress bar" /
 * "Step prerequisites") - the guided 7-step flow's REAL completion state,
 * derived only from already-persisted project/plan/work-map/execution-
 * session/render-artifact facts, never from page visits or client-only
 * flags. Kept as a pure function (no I/O, no React) so every branch is
 * unit-testable without rendering anything - see project-workflow-steps.test.ts.
 */
export const WORKFLOW_STEP_IDS = ["upload", "tellClaude", "reviewPlan", "sceneMappings", "firstPreview", "finalPreview", "render"] as const;
export type WorkflowStepId = (typeof WORKFLOW_STEP_IDS)[number];

export type WorkflowStepState = "complete" | "current" | "locked" | "notStarted";

export interface ComputedWorkflowStep {
  id: WorkflowStepId;
  state: WorkflowStepState;
}

export interface WorkflowStepInput {
  /** Always true on a real project page (the project must exist to view it) - kept explicit rather than assumed, so this function has no hidden "must be called from a project page" precondition. */
  hasProject: boolean;
  workMapEntryCount: number;
  hasPlan: boolean;
  planApproved: boolean;
  /** True once the execution session's own firstPreviewApproved flag is true (approve-first-preview.ts) - never inferred from anything else. */
  firstPreviewApproved: boolean;
  /** True once every required (use=true, APPROVED, no unresolvedReasons) scene has completed EXECUTE_FRAME in the current session - the SAME real precondition resolve-render-dispatch.ts itself enforces before RENDER can be dispatched. */
  allScenesComplete: boolean;
  hasRenderArtifact: boolean;
}

/**
 * "Final Preview" (step 6) has no distinct backend-persisted approval flag
 * today - resolve-render-dispatch.ts's own real precondition for RENDER is
 * exactly `firstPreviewApproved && allScenesComplete`, nothing else (see
 * that file's own doc comment, confirmed directly from the render-dispatch
 * source during this task). This function does NOT fabricate a
 * `finalPreviewApproved` flag that doesn't exist - `finalPreview` becomes
 * "complete" (a guided pass-through checkpoint, not a hard gate) the
 * moment `allScenesComplete` is true, exactly when the real RENDER
 * precondition would also already be satisfied. See RUNBOOK.md/the task's
 * own final report for the honest framing of this as a UI-only guided
 * step, not a new backend approval gate.
 */
export function computeWorkflowSteps(input: WorkflowStepInput): ComputedWorkflowStep[] {
  const uploadComplete = input.hasProject;
  const tellClaudeComplete = input.workMapEntryCount > 0;
  const reviewPlanComplete = input.hasPlan;
  const sceneMappingsComplete = input.hasPlan && input.planApproved;
  const firstPreviewComplete = input.firstPreviewApproved;
  // Matches resolve-render-dispatch.ts's own real RENDER precondition
  // exactly: `firstPreviewApproved && allScenesComplete` together, never
  // allScenesComplete alone - EXECUTE_FRAME dispatch itself does not
  // independently enforce firstPreviewApproved (only the dashboard's own
  // button visibility does), so allScenesComplete can technically become
  // true before firstPreviewApproved is - this must not show as "final
  // preview complete" in that case.
  const finalPreviewComplete = input.firstPreviewApproved && input.allScenesComplete;
  const renderComplete = input.hasRenderArtifact;

  return [
    { id: "upload", state: uploadComplete ? "complete" : "notStarted" },
    { id: "tellClaude", state: tellClaudeComplete ? "complete" : uploadComplete ? "current" : "locked" },
    { id: "reviewPlan", state: reviewPlanComplete ? "complete" : tellClaudeComplete ? "current" : "locked" },
    { id: "sceneMappings", state: sceneMappingsComplete ? "complete" : reviewPlanComplete ? "current" : "locked" },
    { id: "firstPreview", state: firstPreviewComplete ? "complete" : sceneMappingsComplete ? "current" : "locked" },
    { id: "finalPreview", state: finalPreviewComplete ? "complete" : firstPreviewComplete ? "current" : "locked" },
    { id: "render", state: renderComplete ? "complete" : finalPreviewComplete ? "current" : "locked" }
  ];
}

/** The one step the client should focus on right now - the first non-complete step, or the last step if everything is done. */
export function currentStepIndex(steps: ComputedWorkflowStep[]): number {
  const index = steps.findIndex((step) => step.state === "current");
  if (index !== -1) return index;
  const firstLocked = steps.findIndex((step) => step.state === "locked");
  if (firstLocked !== -1) return Math.max(0, firstLocked - 1);
  return steps.length - 1;
}
