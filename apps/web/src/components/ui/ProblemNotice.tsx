"use client";

import { AlertTriangle } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useLocale } from "../LocaleProvider";

export interface ProblemNoticeProps {
  /** What went wrong, in plain words and TRUE - never the name of an internal step that did not actually fail. */
  title: string;
  /** What to do about it. */
  description?: string;
  /** The raw worker/server message, verbatim. Kept, because it is what makes a failure findable - but behind a closed disclosure. */
  technicalDetails?: string | null;
  /** The one thing to press, if there is one. */
  action?: ReactNode;
}

/**
 * A failure said in the client's words, with the evidence kept (2026-10-04).
 *
 * Seen live that day: a scene build failed inside After Effects and the page
 * said "Could not dispatch this job" - untrue, it was dispatched fine - over
 * a raw worker sentence ("operation 2 (SET_TEXT) failed: …"). The raw text is
 * the right thing to keep and the wrong thing to lead with, so it moves
 * behind "Technical details", closed, word for word.
 */
export function ProblemNotice({ title, description, technicalDetails, action }: ProblemNoticeProps): ReactElement {
  const { t } = useLocale();
  return (
    <div className="state-panel state-panel--error problem-notice" role="alert">
      <AlertTriangle className="state-panel__icon" size={22} aria-hidden="true" />
      <p className="state-panel__title">{title}</p>
      {description ? <p className="state-panel__description">{description}</p> : null}
      {action ? <div className="state-panel__actions">{action}</div> : null}
      {technicalDetails ? (
        <details className="advanced-details problem-notice__details">
          <summary>{t.common.technicalDetails}</summary>
          <pre className="problem-notice__raw">{technicalDetails}</pre>
        </details>
      ) : null}
    </div>
  );
}
