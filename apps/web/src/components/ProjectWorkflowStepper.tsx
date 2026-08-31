"use client";

import Link from "next/link";
import { Check, Lock } from "lucide-react";
import type { ReactElement } from "react";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useProjectStepperStatus } from "../lib/use-project-stepper-status";
import { computeWorkflowSteps, currentStepIndex, WORKFLOW_STEP_IDS, type WorkflowStepId, type WorkflowStepState } from "../lib/project-workflow-steps";
import { useLocale } from "./LocaleProvider";

function stepHref(projectId: string, id: WorkflowStepId): string {
  switch (id) {
    case "upload":
      return `/projects/${projectId}/assets`;
    case "tellClaude":
    case "reviewPlan":
      return `/projects/${projectId}/work-map`;
    case "sceneMappings":
      return `/projects/${projectId}/scenes`;
    case "firstPreview":
    case "finalPreview":
      return `/projects/${projectId}`;
    case "render":
      return `/projects/${projectId}/render-settings`;
  }
}

/**
 * Client-handoff phase, section A/B ("Global step-by-step progress bar") -
 * the PRIMARY orientation layer on every project page: where the client
 * is, what to do now, and what happens next. Every step's completion
 * state is derived from real persisted facts (project-workflow-steps.ts)
 * - never from which page has been visited. Existing tabs remain the
 * secondary/direct navigation layer, unchanged.
 */
export function ProjectWorkflowStepper(): ReactElement | null {
  const { t } = useLocale();
  const { project, plan } = useProjectWorkspaceContext();
  const projectId = project?.project.projectId ?? "";
  const { workMap, session, renderArtifacts, isLoading } = useProjectStepperStatus(projectId);

  if (!project) {
    return null;
  }

  // Same "required scenes" / "all complete" definition ProjectOverviewTab.tsx
  // already uses for its own Execute/Render button logic - never a second,
  // independently-invented rule that could disagree with what actually
  // gates those real actions.
  const activeSession = session && session.status !== "FAILED" ? session : null;
  const requiredScenePlanIds =
    plan && plan.plan.status === "APPROVED"
      ? plan.plan.scenePlans.filter((scene) => scene.use && scene.approvalState === "APPROVED" && scene.unresolvedReasons.length === 0).map((s) => s.id)
      : [];
  const allScenesComplete =
    activeSession !== null && requiredScenePlanIds.length > 0 && requiredScenePlanIds.every((id) => activeSession.completedScenePlanIds.includes(id));

  const steps = computeWorkflowSteps({
    hasProject: true,
    workMapEntryCount: workMap?.entries.length ?? 0,
    hasPlan: plan !== null,
    planApproved: plan?.plan.status === "APPROVED",
    firstPreviewApproved: activeSession?.firstPreviewApproved ?? false,
    allScenesComplete,
    hasRenderArtifact: (renderArtifacts?.length ?? 0) > 0
  });
  const currentIndex = currentStepIndex(steps);
  const currentStep = steps[currentIndex]!;

  const stepTitle = t.projectWorkspace.stepper.steps[currentStep.id].title;
  const stepDescription = t.projectWorkspace.stepper.steps[currentStep.id].description;

  return (
    <nav className="workflow-stepper" aria-label={t.projectWorkspace.stepper.ariaLabel}>
      <p className="workflow-stepper__current">
        {t.projectWorkspace.stepper.stepOfTotal(currentIndex + 1, WORKFLOW_STEP_IDS.length, stepTitle)}
      </p>
      <p className="workflow-stepper__hint">{stepDescription}</p>
      <ol className="workflow-stepper__list" data-loading={isLoading ? "true" : undefined}>
        {steps.map((step, index) => {
          const label = t.projectWorkspace.stepper.steps[step.id].title;
          const statusLabel = statusLabelFor(t, step.state);
          const content = (
            <>
              <span className="workflow-stepper__marker" data-state={step.state}>
                {step.state === "complete" ? <Check aria-hidden="true" /> : step.state === "locked" ? <Lock aria-hidden="true" /> : index + 1}
              </span>
              <span className="workflow-stepper__label">
                {label}
                <span className="workflow-stepper__status">{statusLabel}</span>
              </span>
            </>
          );
          return (
            <li key={step.id} className="workflow-stepper__item" data-state={step.state}>
              {step.state === "locked" ? (
                <span className="workflow-stepper__step" aria-disabled="true">
                  {content}
                </span>
              ) : (
                <Link href={stepHref(projectId, step.id)} className="workflow-stepper__step">
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function statusLabelFor(t: ReturnType<typeof useLocale>["t"], state: WorkflowStepState): string {
  switch (state) {
    case "complete":
      return t.projectWorkspace.stepper.status.complete;
    case "current":
      return t.projectWorkspace.stepper.status.inProgress;
    case "locked":
      return t.projectWorkspace.stepper.status.locked;
    case "notStarted":
      return t.projectWorkspace.stepper.status.ready;
  }
}
