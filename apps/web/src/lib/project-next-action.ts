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
  /**
   * 2026-10-02: the project has no files yet, so every per-placeholder asset
   * dropdown in the edit drawer is necessarily empty. A POINTER, never a
   * gate - the API approves a plan with no assets perfectly happily (a
   * text-only edit is a real, legitimate use), so nothing here blocks
   * anything. It only names the step that has to come first in practice.
   */
  "uploadFiles",
  "reviewScenes",
  "approveScenes",
  "startFirstPreview",
  "approveFirstPreview",
  "executeRemainingScenes",
  /**
   * 2026-10-04: a scene is being built on the editing computer right now.
   * The banner used to keep saying "press Start execution" for the whole
   * build, and after it - a wait is a real state and gets its own words.
   */
  "buildingVideo",
  "configureRenderOutput",
  /** 2026-10-04: everything is built and the first frame is approved, but no complete preview of the current work exists - split out of reviewFinalPreview, which used to mean "make it, watch it AND approve it" in one breath. */
  "makeFullVideo",
  /** 2026-10-04: the complete preview is being made right now - minutes during which nothing on screen used to change, so people pressed the button again. */
  "waitForFullVideo",
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
  /** Real assets in THIS project's own Asset Catalog. Zero means no placeholder can be given an image or video yet, whatever the scene review says. */
  assetCount: number;
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
  /**
   * The four below were added 2026-10-04, when the banner was seen saying
   * "Create the first preview - press Start execution" with the finished
   * first frame on screen under it. All optional, all read as "no" when
   * absent: a caller that cannot tell must not claim a wait or a result.
   *
   * A scene-building job for this project is live (queued, claimed or
   * running) in the same job history the Jobs page lists.
   */
  sceneBuildInFlight?: boolean;
  /** A complete-preview job for the current session is live in that same job history. */
  fullPreviewInFlight?: boolean;
  /** A complete preview exists AND was made from the session's current working copy - the same freshness rule the Preview tab's own card applies before showing a video. */
  fullPreviewReady?: boolean;
  /**
   * Simple mode: the Preview tab sets the Landscape output up by itself, or
   * asks for it right there, so an unconfigured output is not a separate
   * step on another tab. Advanced keeps the pointer at Export, as before.
   */
  fullVideoSetupOnPreviewTab?: boolean;
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
    // Files before scene review: with an empty Asset Catalog the drawer's
    // asset dropdowns have nothing in them, so "settle every scene" is an
    // instruction a client cannot actually carry out. Deliberately inside
    // the not-yet-approved branch only - once a plan IS approved, the
    // project has moved past content assignment and pointing back at
    // uploads would be a step backwards.
    if (input.assetCount === 0) {
      return { id: "uploadFiles", tab: "assets" };
    }
    // An included-scene count of zero is a real, reachable dead end (every
    // scene excluded): approving would produce nothing, so the honest next
    // action is still "go review the scenes", never "approve".
    if (input.scenesNeedingReview > 0 || input.includedSceneCount === 0) {
      return { id: "reviewScenes", tab: "scenes" };
    }
    // ORDERING, AND WHY THERE IS NO "SET THE REELS LAYOUT" STEP HERE.
    //
    // Real 2026-09-27 incident: setting the Reels layout AFTER approval is a
    // plan edit, so it returned the plan to DRAFT and took the live session
    // and both preview approvals with it - and this list's own order put
    // render configuration after the previews, so following it walked
    // straight into that. The obvious fix is to insert "set the Reels
    // layout" ahead of approval. It was considered and deliberately not
    // done, for two reasons:
    //
    //  1. NOTHING KNOWS WHETHER THIS VIDEO NEEDS A VERTICAL VERSION. There
    //     is no persisted fact to derive it from, and a step that cannot be
    //     derived would have to be assumed - which is exactly what this
    //     module refuses to do. Every project would be told to do work most
    //     of them do not need, and the list would stall on it.
    //  2. IT WOULD BE A GATE THIS FILE DOES NOT OWN. The API approves a plan
    //     with no Reels layout perfectly happily. A UI-only step ordering
    //     that pretends otherwise is a second source of truth by another
    //     name, and the three real MVP templates were approved without one.
    //
    // So the warning lives where the damage is done (ReelsLayoutCard, via
    // plan-edit-impact.ts, which names the loss before it happens), and the
    // approval step's own copy carries the ordering advice - one string,
    // shown by both the banner and the checklist, no new state anywhere.
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
    // A frame waiting for a decision outranks a job in flight: the person
    // has something to look at right now, whatever else is running.
    if (input.awaitingFirstPreviewApproval) {
      return { id: "approveFirstPreview", tab: "preview" };
    }
    return { id: input.sceneBuildInFlight ? "buildingVideo" : "startFirstPreview", tab: "preview" };
  }
  if (!input.allScenesComplete) {
    return { id: input.sceneBuildInFlight ? "buildingVideo" : "executeRemainingScenes", tab: "preview" };
  }
  if (!input.fullPreviewApproved) {
    if (input.fullPreviewInFlight) {
      return { id: "waitForFullVideo", tab: "preview" };
    }
    if (input.fullPreviewReady) {
      return { id: "reviewFinalPreview", tab: "preview" };
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
    //
    // 2026-10-04: in Simple mode the Preview tab now takes that step on
    // itself (it either knows the answer or shows the same form in place),
    // because a client was sent from "Create Complete Preview" to another
    // tab to type After Effects template names.
    if (!input.landscapeRenderConfigured && !input.fullVideoSetupOnPreviewTab) {
      return { id: "configureRenderOutput", tab: "export" };
    }
    return { id: "makeFullVideo", tab: "preview" };
  }
  // The complete preview is approved but the output it would render from is
  // missing or stale (the template was re-inspected since): Export holds the
  // form for exactly that case.
  if (!input.landscapeRenderConfigured) {
    return { id: "configureRenderOutput", tab: "export" };
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
export function resolveTabLocks(input: Pick<NextActionInput, "stateUnknown" | "hasPlan" | "planApproved" | "executableSceneCount" | "fullPreviewApproved" | "hasRenderArtifact">): {
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
    // A finished render makes Export genuinely usable, whatever the CURRENT
    // session says. Real 2026-09-27 report: once a session completes, its
    // fullPreviewApproved is no longer the project's live state, so Export
    // was marked locked on a project whose videos were sitting there and
    // downloading fine - the tab opened and worked, with a lock on it. A
    // lock that contradicts the page behind it teaches people to ignore
    // locks, which is worse than having none.
    export: !input.fullPreviewApproved && !input.hasRenderArtifact
  };
}
