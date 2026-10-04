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

export function ScenesGuide({ steps, heading }: { steps: readonly GuideStep[]; heading: string }): ReactElement {
  const currentIndex = steps.findIndex((step) => !step.done);
  return (
    <div className="scenes-guide">
      <p className="scenes-guide__heading">{heading}</p>
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
                {/* A later step shows only its name: its instruction would be about a screen the client is not at yet. */}
                {state === "later" ? null : <span className="scenes-guide__detail"> {step.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
