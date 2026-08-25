import { Inbox } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps): ReactElement {
  return (
    <div className="state-panel state-panel--empty" role="status">
      <Inbox className="state-panel__icon" size={22} aria-hidden="true" />
      <p className="state-panel__title">{title}</p>
      {description ? <p className="state-panel__description">{description}</p> : null}
      {action ? <div className="state-panel__actions">{action}</div> : null}
    </div>
  );
}
