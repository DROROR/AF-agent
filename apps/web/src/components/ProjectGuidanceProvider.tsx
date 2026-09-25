"use client";

import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useProjectStepperStatus } from "../lib/use-project-stepper-status";
import { computeWorkflowSteps, currentStepIndex, type ComputedWorkflowStep } from "../lib/project-workflow-steps";
import { resolveNextAction, resolveTabLocks, type NextAction } from "../lib/project-next-action";

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
}

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
 * it. No new API calls were added for any of this: every input below comes
 * either from ProjectWorkspaceProvider's existing project+plan load or from
 * that same pre-existing useProjectStepperStatus call.
 */
export function ProjectGuidanceProvider({ projectId, children }: { projectId: string; children: ReactNode }): ReactElement {
  const { project, plan } = useProjectWorkspaceContext();
  const { workMap, session, renderArtifacts, isLoading, hasError } = useProjectStepperStatus(projectId);

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

  const stateUnknown = isLoading || hasError;

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
    scenesNeedingReview,
    includedSceneCount: includedScenes.length,
    executableSceneCount: executableScenePlanIds.length,
    awaitingFirstPreviewApproval: activeSession?.status === "AWAITING_PREVIEW_APPROVAL",
    firstPreviewApproved: activeSession?.firstPreviewApproved ?? false,
    allScenesComplete,
    landscapeRenderConfigured,
    fullPreviewApproved: activeSession?.fullPreviewApproved ?? false,
    hasRenderArtifact: (renderArtifacts?.length ?? 0) > 0
  };

  const value: ProjectGuidance = {
    stateUnknown,
    loadFailed: hasError,
    steps,
    currentStepIndex: currentStepIndex(steps),
    nextAction: resolveNextAction(nextActionInput),
    tabLocks: resolveTabLocks(nextActionInput)
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
