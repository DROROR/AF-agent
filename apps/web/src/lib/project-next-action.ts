/**
 * "What do I do next, and where is it?" - the single, real answer, derived
 * only from already-persisted project/plan/session/render facts.
 *
 * REAL 2026-09-25 INCIDENT: the operator who runs this dashboard every day
 * could not tell which step a project was on or which tab to open next, and
 * had to be talked through every click. The global stepper
 * (project-workflow-steps.ts) already showed WHICH OF SEVEN PHASES a project
 * was in, but a phase is not an action: "Match Your Content" does not tell
 * anyone that the button they need is "Approve Scenes" on the Scenes tab,
 * and nothing at all pointed at Render Settings - the step that must happen
 * between First Preview and Export, on a tab that Simple Mode hides.
 *
 * So this module answers the narrower, more useful question: the ONE next
 * action, its name, and the tab it lives on. It is deliberately finer-
 * grained than the 7-step model (several next actions can map to one step)
 * and deliberately separate from it: computeWorkflowSteps stays the
 * progress spine, this is the pointer.
 *
 * Two rules this file exists to enforce:
 *
 *  1. NEVER INVENT STATE. When the real session/work-map/render state has
 *     not loaded, or genuinely failed to load, the answer is "unknown" -
 *     the UI then says it cannot tell, rather than confidently naming a
 *     wrong next action. Silently treating a failed fetch as "no session
 *     yet" would point a half-finished project back at "Start First
 *     Preview", which is exactly the kind of wrong-but-confident
 *     instruction that caused the incident.
 *
 *  2. NEVER A SECOND SOURCE OF TRUTH. Each branch below mirrors a
 *     precondition that is already enforced elsewhere (server-side dispatch
 *     resolvers, and the very buttons this points at). Nothing here grants
 *     or gates anything - it only names what is already true.
 *
 * Pure: no I/O, no React, so every branch is unit-testable without
 * rendering (see project-next-action.test.ts).
 */

/** Tabs a next action can live on - the same keys ProjectWorkspaceShell's own nav and `dictionary.projectWorkspace.tabs` already use, never a new naming scheme. */
export const NEXT_ACTION_TABS = ["overview", "assets", "scenes", "preview", "export", "renderSettings", "workMap"] as const;
export type NextActionTab = (typeof NEXT_ACTION_TABS)[number];

export const NEXT_ACTION_IDS = [
  /** The real state has not loaded (or failed to load) - the UI must SAY it cannot tell, never guess. */
  "unknown",
  "createPlan",
  "reviewScenes",
  "approveScenes",
  "startFirstPreview",
  "approveFirstPreview",
  "executeRemainingScenes",
  "configureRenderOutput",
  "reviewFinalPreview",
  "render",
  "done"
] as const;
export type NextActionId = (typeof NEXT_ACTION_IDS)[number];

export interface NextAction {
  id: NextActionId;
  /** Where the action lives. `null` only for "unknown" (nowhere to send anyone) and "done" (nothing left to do). */
  tab: NextActionTab | null;
}

export interface NextActionInput {
  /**
   * True while the extra real state (work map / execution session / render
   * artifacts) is still loading, OR when any of those fetches genuinely
   * failed. Both cases mean the same thing to a human: we do not know where
   * this project is. See use-project-stepper-status.ts, which now reports a
   * failed fetch as `hasError` instead of quietly flattening it to "absent".
   */
  stateUnknown: boolean;
  hasPlan: boolean;
  planApproved: boolean;
  /** Included (use=true) scenes that are not yet APPROVED, or still carry unresolvedReasons - i.e. scenes a human still has to look at. */
  scenesNeedingReview: number;
  /** Scenes marked use=true, regardless of approval state. Zero means the plan currently produces no video at all. */
  includedSceneCount: number;
  /** use=true AND APPROVED AND no unresolvedReasons - the exact set ProjectPreviewTab and EXECUTE_FRAME dispatch treat as executable. */
  executableSceneCount: number;
  /** The current session is parked on the first-frame approval gate (status AWAITING_PREVIEW_APPROVAL) - the human has something to look at right now. */
  awaitingFirstPreviewApproval: boolean;
  /** The session's own persisted firstPreviewApproved flag - never inferred. */
  firstPreviewApproved: boolean;
  /** Every executable scene has completed EXECUTE_FRAME in the current session. */
  allScenesComplete: boolean;
  /**
   * The LANDSCAPE master composition is configured on the plan AND was
   * configured against the CURRENT source project hash. A stale config
   * counts as not configured, exactly as ProjectExportTab's own render gate
   * treats it - otherwise Export offers a button that can only ever say
   * "Not configured" once clicked.
   */
  landscapeRenderConfigured: boolean;
  /** The session's own persisted fullPreviewApproved flag - the same gate resolve-render-dispatch.ts enforces server-side. */
  fullPreviewApproved: boolean;
  hasRenderArtifact: boolean;
}

/**
 * Resolution order follows the real production workflow, and each branch
 * fires only while its own precondition is genuinely unmet - so the answer
 * moves forward on its own as real work lands, and never has to be reset.
 */
export function resolveNextAction(input: NextActionInput): NextAction {
  if (input.stateUnknown) {
    return { id: "unknown", tab: null };
  }
  if (!input.hasPlan) {
    return { id: "createPlan", tab: "scenes" };
  }
  if (!input.planApproved) {
    // An included-scene count of zero is a real, reachable dead end (every
    // scene excluded): approving would produce nothing, so the honest next
    // action is still "go review the scenes", never "approve".
    if (input.scenesNeedingReview > 0 || input.includedSceneCount === 0) {
      return { id: "reviewScenes", tab: "scenes" };
    }
    return { id: "approveScenes", tab: "scenes" };
  }
  // REAL 2026-09-14 DEFECT (see project-workflow-steps.ts): an APPROVED plan
  // whose scenes are not individually approved/resolved leaves the Preview
  // tab saying "No approved scene to execute" while everything upstream
  // looks finished. Point back at Scenes rather than at a button that
  // cannot work.
  if (input.executableSceneCount === 0) {
    return { id: "reviewScenes", tab: "scenes" };
  }
  if (!input.firstPreviewApproved) {
    return { id: input.awaitingFirstPreviewApproval ? "approveFirstPreview" : "startFirstPreview", tab: "preview" };
  }
  if (!input.allScenesComplete) {
    return { id: "executeRemainingScenes", tab: "preview" };
  }
  // THE DEAD END, now closed. Without a LANDSCAPE master the Export tab's
  // render button is permanently disabled, and the only form that could set
  // one lived on Render Settings - a tab the normal (Simple) nav does not
  // list at all. The instruction therefore used to be "switch to Advanced
  // view and open Render Settings", which is a request to understand the
  // app's structure, not an action. That exact form is now rendered inline
  // on the Export tab whenever the output it belongs to is unconfigured or
  // stale (ProjectExportTab -> VariantConfigCard, the very same component,
  // not a copy), so the next action points at a tab that is always in the
  // nav and contains its own fix.
  if (!input.landscapeRenderConfigured) {
    return { id: "configureRenderOutput", tab: "export" };
  }
  if (!input.fullPreviewApproved) {
    return { id: "reviewFinalPreview", tab: "preview" };
  }
  if (!input.hasRenderArtifact) {
    return { id: "render", tab: "export" };
  }
  return { id: "done", tab: null };
}

/**
 * Which of the two genuinely gated tabs are locked right now, so the nav can
 * show WHY instead of just letting someone land on a dead end. These mirror
 * the exact conditions ProjectPreviewTab/ProjectExportTab already apply
 * before rendering LockedStepNotice - the nav must never disagree with the
 * page it links to.
 */
export function resolveTabLocks(input: Pick<NextActionInput, "stateUnknown" | "hasPlan" | "planApproved" | "executableSceneCount" | "fullPreviewApproved">): {
  preview: boolean;
  export: boolean;
} {
  if (input.stateUnknown) {
    // Unknown is not locked: never tell someone a tab is closed when we
    // cannot actually tell. The banner says "checking" instead.
    return { preview: false, export: false };
  }
  return {
    preview: !(input.hasPlan && input.planApproved && input.executableSceneCount > 0),
    export: !input.fullPreviewApproved
  };
}
