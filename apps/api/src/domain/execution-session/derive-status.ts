import type { ExecutionSessionStatus } from "@dyo/schemas";

export interface DeriveExecutionSessionStatusInput {
  /** Every scenePlanId that must complete before this session is READY_TO_RENDER - the plan's own use=true/APPROVED/no-unresolved-reasons scenes, same filter resolveExecuteFrameDispatch already applies per-scene. */
  requiredScenePlanIds: string[];
  completedScenePlanIds: string[];
  firstPreviewApproved: boolean;
}

/**
 * Pure status derivation (multi-scene-accumulation phase, section 2:
 * "Keep status model minimal") - PREPARING/EDITING/AWAITING_PREVIEW_APPROVAL/
 * READY_TO_RENDER are entirely computable from concrete, already-persisted
 * fields, so this is the single source of truth for all of them rather
 * than tracking imperative state-machine transitions at each call site.
 *
 * Never returns COMPLETED/FAILED/RENDERING/PAUSED:
 *   - COMPLETED/FAILED are terminal (see TERMINAL_EXECUTION_SESSION_STATUSES,
 *     execution-session.ts) and only ever set explicitly by an event this
 *     pure function isn't given - a render success (record-render-artifact's
 *     own session side effect) or a working-copy chain-of-custody failure
 *     (record-execute-frame-result.ts). Callers must never invoke this
 *     function against an already-terminal session - once COMPLETED/FAILED,
 *     nothing re-derives a status for it (dispatch itself already refuses
 *     any further job for a terminal session, so no caller legitimately
 *     needs to).
 *   - RENDERING/PAUSED depend on live worker/job state this function is
 *     never given - see derive-display-status.ts, computed only at read
 *     time, never persisted.
 */
export function deriveExecutionSessionStatus(input: DeriveExecutionSessionStatusInput): ExecutionSessionStatus {
  if (input.completedScenePlanIds.length === 0) {
    return "PREPARING";
  }
  if (!input.firstPreviewApproved) {
    return "AWAITING_PREVIEW_APPROVAL";
  }
  const completed = new Set(input.completedScenePlanIds);
  const allRequiredComplete = input.requiredScenePlanIds.every((id) => completed.has(id));
  return allRequiredComplete ? "READY_TO_RENDER" : "EDITING";
}
