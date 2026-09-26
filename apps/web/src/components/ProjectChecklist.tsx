"use client";

import Link from "next/link";
import { Check, CircleAlert, CircleHelp, Lock } from "lucide-react";
import type { ReactElement } from "react";
import { useProjectGuidance } from "./ProjectGuidanceProvider";
import { useLocale } from "./LocaleProvider";
import { WORKFLOW_STEP_IDS, type WorkflowStepState } from "../lib/project-workflow-steps";
import type { NextActionTab } from "../lib/project-next-action";

/** Tab key -> its real route. Same mapping ProjectNextActionBanner uses; kept beside it rather than re-derived from labels. */
function tabHref(projectId: string, tab: NextActionTab): string {
  switch (tab) {
    case "overview":
      return `/projects/${projectId}`;
    case "assets":
      return `/projects/${projectId}/assets`;
    case "scenes":
      return `/projects/${projectId}/scenes`;
    case "preview":
      return `/projects/${projectId}/preview`;
    case "export":
      return `/projects/${projectId}/export`;
    case "renderSettings":
      return `/projects/${projectId}/render-settings`;
    case "workMap":
      return `/projects/${projectId}/work-map`;
  }
}

/**
 * The project's front page: one list, in order, of everything that has to
 * happen to get a video out - with the step you are on opened up and the
 * thing to press inside it.
 *
 * WHY THIS EXISTS. The operator who runs this dashboard every day could not
 * use it without being talked through each click by phone, and after a first
 * round of wayfinding work said plainly that it was still too complex. Their
 * own diagnosis was the useful one: "steppers theek nahi... upar kuch hai
 * neeche kuch hai" - something up top, something else below. Three separate
 * things were answering "where am I and what now" at the same time: a
 * seven-chip progress stepper, the next-action banner, and a "Next" marker
 * on a tab. Three readings for one fact, and none of them contained the
 * actual next move - each one only pointed somewhere else.
 *
 * So this replaces the stepper rather than joining it. The seven steps still
 * appear, because a person needs to see that the job is finite and where
 * they are in it, but only ONE row is interactive: the one they are on,
 * carrying the real action and a button straight to it. Finished rows are
 * ticks. Not-yet rows are greyed with a reason. There is nothing else to
 * click, so there is nothing to decide about how to navigate.
 *
 * TWO RULES IT DOES NOT BEND:
 *
 *  1. It computes nothing. Every value comes from ProjectGuidanceProvider -
 *     the same single derivation the banner and the tab locks read - so this
 *     list can never disagree with the rest of the workspace. Adding a
 *     second derivation here would eventually drift, and a confidently wrong
 *     instruction is worse than no instruction at all.
 *
 *  2. It never invents a step. While the real work-map/session/render state
 *     is still loading, or genuinely failed to load, NO steps are drawn -
 *     not greyed, not guessed, none. A half-finished project whose status
 *     request failed used to render as "you have not started yet", which is
 *     the exact kind of confident lie that caused the original incident.
 *     "Still checking" and "could not check" are different facts and get
 *     different words.
 */
export function ProjectChecklist({ projectId }: { projectId: string }): ReactElement {
  const { t } = useLocale();
  const { steps, currentStepIndex, nextAction, stateUnknown, loadFailed } = useProjectGuidance();
  const copy = t.projectWorkspace.checklist;
  const stepCopy = t.projectWorkspace.stepper.steps;

  if (stateUnknown || nextAction.id === "unknown") {
    return (
      <section className="project-checklist project-checklist--unknown" aria-label={copy.heading} data-state={loadFailed ? "failed" : "loading"}>
        <div className="project-checklist__unknown-body">
          {loadFailed ? <CircleAlert aria-hidden="true" size={18} /> : <CircleHelp aria-hidden="true" size={18} />}
          <div>
            <p className="project-checklist__unknown-title">
              {loadFailed ? t.projectWorkspace.nextAction.loadFailedTitle : t.projectWorkspace.nextAction.unknownTitle}
            </p>
            <p className="project-checklist__unknown-description">
              {loadFailed ? t.projectWorkspace.nextAction.loadFailedDescription : t.projectWorkspace.nextAction.unknownDescription}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const action = t.projectWorkspace.nextAction.actions[nextAction.id];
  const completedCount = steps.filter((step) => step.state === "complete").length;
  const actionTab = nextAction.tab;

  return (
    <section className="project-checklist" aria-label={copy.heading}>
      <div className="project-checklist__header">
        <h2 className="project-checklist__heading">{copy.heading}</h2>
        <p className="project-checklist__progress">{copy.progress(completedCount, WORKFLOW_STEP_IDS.length)}</p>
      </div>
      <ol className="project-checklist__list">
        {steps.map((step, index) => {
          const isCurrent = index === currentStepIndex;
          return (
            <li key={step.id} className="project-checklist__item" data-state={step.state} data-current={isCurrent ? "true" : undefined}>
              <div className="project-checklist__row">
                <span className="project-checklist__marker" data-state={step.state}>
                  {step.state === "complete" ? <Check aria-hidden="true" /> : step.state === "locked" ? <Lock aria-hidden="true" /> : index + 1}
                </span>
                <span className="project-checklist__label">
                  <span className="project-checklist__title">{stepCopy[step.id].title}</span>
                  <span className="project-checklist__status">{statusLabelFor(copy, step.state, isCurrent)}</span>
                </span>
              </div>
              {/*
                Only the row you are on opens, and only it holds a control.
                Everything else in this list is a fact, not a choice - which
                is the whole point: the person is never asked to work out
                which of seven rows to click.
              */}
              {isCurrent ? (
                <div className="project-checklist__action">
                  <p className="project-checklist__action-title">{action.title}</p>
                  <p className="project-checklist__action-description">{action.description}</p>
                  {actionTab === null ? null : (
                    <Link href={tabHref(projectId, actionTab)} className="btn btn--primary btn--sm">
                      {copy.openAction(t.projectWorkspace.tabs[actionTab])}
                    </Link>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Plain words for a state, never the internal name. "current" is split in
 * two on purpose: the step the person is standing on says "Do this now",
 * while a step that is merely reachable says "Ready" - the difference is
 * what stops all seven rows from shouting at once.
 */
function statusLabelFor(copy: { status: { done: string; doThisNow: string; notYet: string; ready: string } }, state: WorkflowStepState, isCurrent: boolean): string {
  if (isCurrent && state !== "complete") {
    return copy.status.doThisNow;
  }
  switch (state) {
    case "complete":
      return copy.status.done;
    case "current":
      return copy.status.doThisNow;
    case "locked":
      return copy.status.notYet;
    case "notStarted":
      return copy.status.ready;
  }
}
