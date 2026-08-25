import { AlertTriangle } from "lucide-react";
import type { ReactElement } from "react";

export interface ErrorStateProps {
  title: string;
  description?: string;
}

export function ErrorState({ title, description }: ErrorStateProps): ReactElement {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <AlertTriangle className="state-panel__icon" size={22} aria-hidden="true" />
      <p className="state-panel__title">{title}</p>
      {description ? <p className="state-panel__description">{description}</p> : null}
    </div>
  );
}
