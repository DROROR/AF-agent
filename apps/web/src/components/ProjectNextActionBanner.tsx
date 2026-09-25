"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, CircleAlert, CircleHelp } from "lucide-react";
import type { ReactElement } from "react";
import { useProjectGuidance } from "./ProjectGuidanceProvider";
import { useLocale } from "./LocaleProvider";
import type { NextActionTab } from "../lib/project-next-action";

/** Tab key -> its real route. Kept next to ProjectWorkspaceShell's own tabsFor() shape rather than re-deriving hrefs from labels. */
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
 * The one "what to do next" line, shown on EVERY tab of a project.
 *
 * REAL 2026-09-25 INCIDENT: the operator who uses this dashboard daily said
 * the UX was very bad because they could not tell which step to do when -
 * which tab to open, which button to press, or why a button was disabled -
 * and had to be talked through every single click. The workflow stepper
 * above already showed WHICH PHASE a project was in, but a phase name is
 * not an instruction. This banner names the actual next action, the actual
 * button, and the actual tab, and either links there or says "you are
 * already on the right tab".
 *
 * Three things it deliberately does NOT do:
 *
 *  - It never computes its own answer. It reads ProjectGuidanceProvider, the
 *    same single derivation the stepper and the tab nav use, so the three
 *    can never contradict each other on screen.
 *  - It never guesses. While the real state is loading, or if it genuinely
 *    failed to load, it says so in plain words instead of naming a step
 *    that might be wrong (guidance.stateUnknown).
 *  - It never links to a route by a name the nav does not use: the link
 *    label is the same `projectWorkspace.tabs.*` string printed on the tab
 *    itself, so "Go to Scenes" always points at the thing labelled "Scenes".
 */
export function ProjectNextActionBanner({ projectId }: { projectId: string }): ReactElement {
  const { t } = useLocale();
  const pathname = usePathname();
  const { nextAction, stateUnknown, loadFailed } = useProjectGuidance();
  const copy = t.projectWorkspace.nextAction;

  if (stateUnknown || nextAction.id === "unknown") {
    // "Could not load" and "still loading" are genuinely different facts and
    // get genuinely different copy - calling a failure a slow load is its own
    // small lie, and this component exists because confident wrong answers
    // were the original problem.
    return (
      <aside className="next-action next-action--unknown" aria-live="polite" data-state={loadFailed ? "failed" : "loading"}>
        {loadFailed ? <CircleAlert aria-hidden="true" size={18} /> : <CircleHelp aria-hidden="true" size={18} />}
        <div className="next-action__body">
          <p className="next-action__title">{loadFailed ? copy.loadFailedTitle : copy.unknownTitle}</p>
          <p className="next-action__description">{loadFailed ? copy.loadFailedDescription : copy.unknownDescription}</p>
        </div>
      </aside>
    );
  }

  const action = copy.actions[nextAction.id];
  const tab = nextAction.tab;
  const href = tab === null ? null : tabHref(projectId, tab);
  const isHere = href !== null && pathname === href;

  return (
    <aside className="next-action" aria-live="polite" data-action={nextAction.id}>
      <ArrowRight aria-hidden="true" size={18} />
      <div className="next-action__body">
        <p className="next-action__heading">{copy.heading}</p>
        <p className="next-action__title">{action.title}</p>
        <p className="next-action__description">{action.description}</p>
      </div>
      {tab === null || href === null ? null : isHere ? (
        <span className="next-action__here">{copy.hereBadge}</span>
      ) : (
        <Link href={href} className="btn btn--primary btn--sm next-action__link">
          {copy.goToAction(t.projectWorkspace.tabs[tab])}
        </Link>
      )}
    </aside>
  );
}
