import { Clock } from "lucide-react";
import type { ReactElement } from "react";

export interface PendingPanelProps {
  title: string;
  description: string;
}

/**
 * Distinct from EmptyState: EmptyState means "the real API works and
 * genuinely returned zero results". PendingPanel means "no backend exists
 * for this yet" - CLAUDE.md's explicit instruction to show a proper
 * pending state rather than fabricating data for a section with no API
 * support today (Jobs history, Approvals, Renders, etc.).
 */
export function PendingPanel({ title, description }: PendingPanelProps): ReactElement {
  return (
    <div className="pending-panel" role="status">
      <Clock className="pending-panel__icon" size={18} aria-hidden="true" />
      <div>
        <p className="pending-panel__title">{title}</p>
        <p className="pending-panel__description">{description}</p>
      </div>
    </div>
  );
}
