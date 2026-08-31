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
  /** True once every required (use=true, APPROVED, no unresolvedReasons) scene has completed EXECUTE_FRAME in the current session - needed to reach (not to complete) the Final Preview step, matching resolveCreateFullPreviewDispatch's own real precondition. */
  allScenesComplete: boolean;
  /**
   * Client-handoff phase, "real final preview approval gate" - the
   * session's own real, persisted `fullPreviewApproved` flag
   * (execution_sessions.full_preview_approved), given only after a human
   * reviews the real full_preview_artifacts video via Approve Final
   * Preview. NEVER derived from allScenesComplete/firstPreviewApproved -
   * this is the exact same flag resolve-render-dispatch.ts's own RENDER
   * precondition checks.
   */
  fullPreviewApproved: boolean;
  hasRenderArtifact: boolean;
}

/**
 * Step 6 ("Final Preview") is complete ONLY once the real, persisted
 * fullPreviewApproved flag is true - never derived from allScenesComplete
 * alone (see WorkflowStepInput.fullPreviewApproved's own doc comment).
 * Step 7 ("Render") stays locked until that same real approval exists,
 * matching resolve-render-dispatch.ts's own backend-enforced RENDER
 * precondition exactly - there is no UI-only bypass: the API independently
 * refuses RENDER dispatch regardless of what this function computes.
 */
export function computeWorkflowSteps(input: WorkflowStepInput): ComputedWorkflowStep[] {
  const uploadComplete = input.hasProject;
  const tellClaudeComplete = input.workMapEntryCount > 0;
  const reviewPlanComplete = input.hasPlan;
  const sceneMappingsComplete = input.hasPlan && input.planApproved;
  const firstPreviewComplete = input.firstPreviewApproved;
  const readyForFinalPreview = input.firstPreviewApproved && input.allScenesComplete;
  const finalPreviewComplete = input.fullPreviewApproved;
  const renderComplete = input.hasRenderArtifact;

  return [
    { id: "upload", state: uploadComplete ? "complete" : "notStarted" },
    { id: "tellClaude", state: tellClaudeComplete ? "complete" : uploadComplete ? "current" : "locked" },
    { id: "reviewPlan", state: reviewPlanComplete ? "complete" : tellClaudeComplete ? "current" : "locked" },
    { id: "sceneMappings", state: sceneMappingsComplete ? "complete" : reviewPlanComplete ? "current" : "locked" },
    { id: "firstPreview", state: firstPreviewComplete ? "complete" : sceneMappingsComplete ? "current" : "locked" },
    { id: "finalPreview", state: finalPreviewComplete ? "complete" : readyForFinalPreview ? "current" : "locked" },
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
