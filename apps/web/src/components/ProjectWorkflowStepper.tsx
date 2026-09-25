"use client";

import Link from "next/link";
import { Check, Lock } from "lucide-react";
import type { ReactElement } from "react";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useProjectGuidance } from "./ProjectGuidanceProvider";
import { WORKFLOW_STEP_IDS, type WorkflowStepId, type WorkflowStepState } from "../lib/project-workflow-steps";
import { useLocale } from "./LocaleProvider";
import { HelpTooltip } from "./ui/HelpTooltip";

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
  const { project } = useProjectWorkspaceContext();
  const { steps, currentStepIndex, stateUnknown } = useProjectGuidance();
  const projectId = project?.project.projectId ?? "";

  if (!project) {
    return null;
  }

  // REAL 2026-09-25 INCIDENT, "never invent state": this used to render a
  // confident "Step 2 of 7 - AI Plan" computed from not-yet-loaded (or
  // failed) fetches, because an absent work map/session/render list and a
  // failed request both arrived here as `null`. A freshly reloaded page on
  // a half-finished project therefore announced the wrong step, and a
  // request failure announced it permanently.
  //
  // A progress bar that cannot state real progress has nothing honest to
  // draw, so it draws nothing: ProjectNextActionBanner renders directly
  // below and says, in words, whether we are still checking or genuinely
  // could not read the state. Saying it once, there, is why this returns
  // null rather than repeating the same sentence in two stacked blocks.
  if (stateUnknown) {
    return null;
  }

  const currentIndex = currentStepIndex;
  const currentStep = steps[currentIndex]!;

  const stepTitle = t.projectWorkspace.stepper.steps[currentStep.id].title;
  const stepDescription = t.projectWorkspace.stepper.steps[currentStep.id].description;

  return (
    <nav className="workflow-stepper" aria-label={t.projectWorkspace.stepper.ariaLabel}>
      <p className="workflow-stepper__current">
        {t.projectWorkspace.stepper.stepOfTotal(currentIndex + 1, WORKFLOW_STEP_IDS.length, stepTitle)}
      </p>
      <p className="workflow-stepper__hint">{stepDescription}</p>
      <ol className="workflow-stepper__list">
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
              {step.id === "firstPreview" ? <HelpTooltip text={t.helpTooltips.firstPreview} /> : null}
              {step.id === "finalPreview" ? <HelpTooltip text={t.helpTooltips.finalPreview} /> : null}
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
