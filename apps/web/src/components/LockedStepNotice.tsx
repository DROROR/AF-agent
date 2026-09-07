import Link from "next/link";
import { Lock } from "lucide-react";
import type { ReactElement } from "react";
import { Card } from "./ui/Card";
import { useLocale } from "./LocaleProvider";

export interface LockedStepNoticeProps {
  projectId: string;
  title: string;
  description: string;
}

/**
 * Client-facing UX simplification, Simple Mode navigation clarity - the
 * honest, actionable replacement for a bare "No execution plan yet" dead
 * end (section 18's own "Bad"/"Better" example). Only reachable in Simple
 * Mode via direct URL entry once the tab nav itself already hides the
 * equivalent locked tab (see ProjectWorkspaceShell) - a genuine safety net,
 * never the primary way a client encounters this. Always links back to the
 * project's own root, where ProjectWorkflowStepper already shows exactly
 * what to do next from real, current state - never a second, independently
 * computed "next step" guess.
 */
export function LockedStepNotice({ projectId, title, description }: LockedStepNoticeProps): ReactElement {
  const { t } = useLocale();
  return (
    <Card className="locked-step-notice">
      <Lock aria-hidden="true" size={20} className="locked-step-notice__icon" />
      <p className="locked-step-notice__title">{title}</p>
      <p className="locked-step-notice__description">{description}</p>
      <Link href={`/projects/${projectId}`} className="btn btn--primary btn--sm">
        {t.projectWorkspace.lockedStep.returnToCurrentStepAction}
      </Link>
    </Card>
  );
}
