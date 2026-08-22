import type { ReactElement } from "react";

export interface ErrorStateProps {
  title: string;
  description?: string;
}

export function ErrorState({ title, description }: ErrorStateProps): ReactElement {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <p className="state-panel__title">{title}</p>
      {description ? <p className="state-panel__description">{description}</p> : null}
    </div>
  );
}
