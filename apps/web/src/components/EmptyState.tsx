import type { ReactElement } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
}

export function EmptyState({ title, description }: EmptyStateProps): ReactElement {
  return (
    <div className="state-panel state-panel--empty" role="status">
      <p className="state-panel__title">{title}</p>
      {description ? <p className="state-panel__description">{description}</p> : null}
    </div>
  );
}
