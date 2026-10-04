"use client";

import { createContext, useContext, useEffect, type ReactElement, type ReactNode } from "react";
import { useWorkspaceModeIfPresent } from "./WorkspaceModeProvider";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useProjectStepperStatus } from "../lib/use-project-stepper-status";
import { useProjectAssets } from "../lib/use-project-assets";
import { computeWorkflowSteps, currentStepIndex, type ComputedWorkflowStep } from "../lib/project-workflow-steps";
import { resolveNextAction, resolveTabLocks, type NextAction } from "../lib/project-next-action";
import { resolvePlanEditImpact, type PlanEditImpact } from "../lib/plan-edit-impact";

export interface ProjectGuidance {
  /**
   * The real work-map/session/render state is still loading, or genuinely
   * failed to load. Nothing else in this object may be presented to a human
   * as fact while this is true - see project-next-action.ts's own
   * "never invent state" note and the 2026-09-25 incident behind it.
   */
  stateUnknown: boolean;
  /** Distinguishes "still checking" from "could not check" - the two need different copy, and pretending a failure is a slow load is its own small lie. */
  loadFailed: boolean;
  steps: ComputedWorkflowStep[];
  currentStepIndex: number;
  nextAction: NextAction;
  tabLocks: { preview: boolean; export: boolean };
  /**
   * What an edit to the execution plan would destroy right now - so any
   * screen that can write a new plan revision warns with the SAME facts,
   * rather than each one working it out (and eventually disagreeing) on its
   * own. See plan-edit-impact.ts and the 2026-09-27 incident behind it.
   */
  planEditImpact: PlanEditImpact;
  /**
   * Re-reads the session / jobs / complete-preview state this guidance is
   * derived from. 2026-10-04: the Preview tab changes that state (a build
   * finishes, a frame is approved) and this provider, which read it once on
   * page load, went on naming the step before - "Create the first preview"
   * under a first preview. Screens that change the state call this; nothing
   * on screen is blanked while it re-reads.
   */
  refresh: () => void;
}

/** How often the guidance re-reads while something is being built or made, so the banner moves on by itself on whichever tab is open. */
const IN_FLIGHT_REFRESH_INTERVAL_MS = 5_000;

const ProjectGuidanceContext = createContext<ProjectGuidance | null>(null);

/**
 * One shared answer to "where is this project, and what happens next" for
 * the whole project workspace.
 *
 * REAL 2026-09-25 INCIDENT: the daily operator of this dashboard could not
 * tell which step a project was on or which tab to open, and had to be
 * walked through every click. The fix needs the same derived truth in three
 * places at once - the progress stepper, the "do this next" banner on every
 * tab, and the locked/next markers in the tab nav - and those three must
 * never disagree. Computing it once here is what makes disagreement
 * impossible; three independent derivations would eventually drift, and a
 * confidently wrong instruction is worse than none.
 *
 * It also means ONE fetch of the extra state (work map / execution session /
 * render artifacts), where previously only ProjectWorkflowStepper fetched
 * it. Every input below comes from ProjectWorkspaceProvider's existing
 * project+plan load, that same pre-existing useProjectStepperStatus call,
 * or - added 2026-10-02 - the Asset Catalog, the one genuinely new fetch
 * here, needed because the next action cannot otherwise tell a project with
 * no files from one ready for scene review.
 */
export function ProjectGuidanceProvider({ projectId, children }: { projectId: string; children: ReactNode }): ReactElement {
  const { project, plan } = useProjectWorkspaceContext();
  const { workMap, session, renderArtifacts, isLoading, hasError, sessionKnown, sceneBuildInFlight, fullPreviewInFlight, fullPreviewReady, refresh } =
    useProjectStepperStatus(projectId);
  // Only a mounted provider saying "simple" counts. With none (some tests,
  // any future screen outside the workspace layout) the pre-2026-10-04
  // pointers are kept exactly.
  const isSimpleMode = useWorkspaceModeIfPresent() === "simple";

  const somethingInFlight = sceneBuildInFlight || fullPreviewInFlight;
  useEffect(() => {
    if (!somethingInFlight) {
      return;
    }
    const interval = setInterval(refresh, IN_FLIGHT_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [somethingInFlight, refresh]);
  // 2026-10-02: the Asset Catalog is now an input too, because "review every
  // scene" is not a carry-out-able instruction while every asset dropdown in
  // the edit drawer is empty. `assets` is null both while loading AND on a
  // failed fetch, and that null is folded into stateUnknown below rather than
  // read as zero - treating "not known yet" as "no files" would point a
  // project that HAS files back at the upload step, which is exactly the
  // confidently-wrong instruction this module exists to prevent.
  const { assets, error: assetsError } = useProjectAssets(projectId);

  // A FAILED session is terminal and is treated as "no active session" by
  // ProjectPreviewTab's own button logic - mirrored here so the guidance
  // can never claim progress that tab would refuse to continue.
  const activeSession = session && session.status !== "FAILED" ? session : null;

  const scenePlans = plan?.plan.scenePlans ?? [];
  const includedScenes = scenePlans.filter((scene) => scene.use);
  const executableScenePlanIds =
    plan && plan.plan.status === "APPROVED"
      ? includedScenes.filter((scene) => scene.approvalState === "APPROVED" && scene.unresolvedReasons.length === 0).map((scene) => scene.id)
      : [];
  const scenesNeedingReview = includedScenes.filter((scene) => scene.approvalState !== "APPROVED" || scene.unresolvedReasons.length > 0).length;
  const allScenesComplete =
    activeSession !== null && executableScenePlanIds.length > 0 && executableScenePlanIds.every((id) => activeSession.completedScenePlanIds.includes(id));

  // The exact same freshness rule ProjectExportTab's own render gate uses:
  // a LANDSCAPE master chosen against an older source project hash cannot
  // render, so it is not "configured" for guidance purposes either.
  const landscapeConfig = plan?.plan.renderOutputs.LANDSCAPE ?? null;
  const landscapeRenderConfigured =
    landscapeConfig !== null && project !== null && landscapeConfig.sourceProjectSha256 === project.manifest.sourceProject.sha256;

  const stateUnknown = isLoading || hasError || assets === null;

  const steps = computeWorkflowSteps({
    hasProject: project !== null,
    workMapEntryCount: workMap?.entries.length ?? 0,
    hasPlan: plan !== null,
    planApproved: plan?.plan.status === "APPROVED",
    hasExecutableScene: executableScenePlanIds.length > 0,
    firstPreviewApproved: activeSession?.firstPreviewApproved ?? false,
    allScenesComplete,
    fullPreviewApproved: activeSession?.fullPreviewApproved ?? false,
    hasRenderArtifact: (renderArtifacts?.length ?? 0) > 0
  });

  const nextActionInput = {
    stateUnknown,
    hasPlan: plan !== null,
    planApproved: plan?.plan.status === "APPROVED",
    assetCount: assets?.length ?? 0,
    scenesNeedingReview,
    includedSceneCount: includedScenes.length,
    executableSceneCount: executableScenePlanIds.length,
    awaitingFirstPreviewApproval: activeSession?.status === "AWAITING_PREVIEW_APPROVAL",
    firstPreviewApproved: activeSession?.firstPreviewApproved ?? false,
    allScenesComplete,
    landscapeRenderConfigured,
    fullPreviewApproved: activeSession?.fullPreviewApproved ?? false,
    hasRenderArtifact: (renderArtifacts?.length ?? 0) > 0,
    sceneBuildInFlight,
    fullPreviewInFlight,
    // Ready only counts for the session the rest of this guidance treats as
    // live - never for a FAILED one.
    fullPreviewReady: activeSession !== null && fullPreviewReady,
    fullVideoSetupOnPreviewTab: isSimpleMode
  };

  const value: ProjectGuidance = {
    stateUnknown,
    loadFailed: hasError || assetsError !== null,
    steps,
    currentStepIndex: currentStepIndex(steps),
    nextAction: resolveNextAction(nextActionInput),
    tabLocks: resolveTabLocks(nextActionInput),
    // Deliberately the RAW session, not `activeSession`: a FAILED session is
    // not active for guidance purposes, but the current-session endpoint
    // still returns one that is recoverable for preview regeneration, and a
    // new plan revision orphans that too. Whatever that endpoint hands back
    // is real work bound to this revision, and losing it is a real loss.
    planEditImpact: resolvePlanEditImpact({
      planApproved: plan?.plan.status === "APPROVED",
      sessionKnown,
      hasSession: session !== null,
      firstPreviewApproved: session?.firstPreviewApproved ?? false,
      fullPreviewApproved: session?.fullPreviewApproved ?? false
    }),
    refresh
  };

  return <ProjectGuidanceContext.Provider value={value}>{children}</ProjectGuidanceContext.Provider>;
}

export function useProjectGuidance(): ProjectGuidance {
  const context = useContext(ProjectGuidanceContext);
  if (!context) {
    throw new Error("useProjectGuidance must be used within a ProjectGuidanceProvider");
  }
  return context;
}

const NO_GUIDANCE_TO_REFRESH = (): void => {};

/**
 * `refresh` for a screen that changes the state the guidance is derived from
 * (see ProjectGuidance.refresh). Does nothing where no guidance is mounted,
 * so a tab can be rendered on its own without one.
 */
export function useProjectGuidanceRefresh(): () => void {
  return useContext(ProjectGuidanceContext)?.refresh ?? NO_GUIDANCE_TO_REFRESH;
}
