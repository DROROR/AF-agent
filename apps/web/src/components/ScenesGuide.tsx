import type { ReactElement } from "react";

/**
 * WHAT TO DO NOW, IN ORDER (2026-10-04).
 *
 * The Scenes tab asked a non-technical client to work out for themselves
 * where to start, what each button was for and when they were finished. This
 * is the same tab's state said as a short numbered list: what is done, the
 * one thing to do now, and what comes after. It decides nothing - every step
 * is handed in already worked out by the view that owns the buttons.
 */
export interface GuideStep {
  title: string;
  detail: string;
  done: boolean;
}

export function ScenesGuide({ steps, heading, summary, progress, allStepsLabel }: { steps: readonly GuideStep[]; heading: string; summary?: string; progress?: string; allStepsLabel?: string }): ReactElement {
  const currentIndex = steps.findIndex((step) => !step.done);
  // The one step that speaks: the step to do now, or the last one once everything is done.
  const spokenIndex = currentIndex === -1 ? steps.length - 1 : currentIndex;
  const spoken = steps[spokenIndex];
  return (
    <div className="scenes-guide">
      {/*
        2026-10-07, the operator: the seven steps of the video already stand
        at the top of every tab, and this list of five was a second wall under
        them. Only the step to do now is on screen: its number, its title and
        its words. The full list stays one press away.
      */}
      <div className="scenes-guide__head">
        <p className="scenes-guide__heading">{heading}</p>
        {progress ? <span className="scenes-guide__progress">{progress}</span> : null}
      </div>
      {summary ? <p className="scenes-guide__summary">{summary}</p> : null}
      {spoken ? (
        <p className="scenes-guide__now" data-state={currentIndex === -1 ? "done" : "now"}>
          <span className="scenes-guide__marker" aria-hidden="true">
            {spoken.done ? "✓" : spokenIndex + 1}
          </span>
          <span>
            <strong>{spoken.title}</strong>
            <span className="scenes-guide__detail"> {spoken.detail}</span>
          </span>
        </p>
      ) : null}
      <details className="advanced-details scenes-guide__all">
        <summary>{allStepsLabel ?? heading}</summary>
        <ol>
          {steps.map((step, index) => {
            const state = step.done ? "done" : index === currentIndex ? "now" : "later";
            return (
              <li key={step.title} data-state={state} aria-current={state === "now" ? "step" : undefined}>
                <span className="scenes-guide__marker" aria-hidden="true">
                  {step.done ? "✓" : index + 1}
                </span>
                <span>
                  <strong>{step.title}</strong>
                </span>
              </li>
            );
          })}
        </ol>
      </details>
    </div>
  );
}
