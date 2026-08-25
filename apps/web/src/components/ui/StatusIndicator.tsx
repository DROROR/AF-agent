import type { ReactElement } from "react";
import { STATUS_TONE, type BadgeStatus } from "../StatusBadge";
import { useLocale } from "../LocaleProvider";

export interface StatusIndicatorProps {
  status: BadgeStatus;
  label?: string;
}

/** Compact dot + label for dense contexts (topbar) - reuses StatusBadge's own tone mapping so a status is never presented two different ways in the app. */
export function StatusIndicator({ status, label }: StatusIndicatorProps): ReactElement {
  const { t } = useLocale();
  const tone = STATUS_TONE[status];
  return (
    <span className="status-indicator">
      <span className={`status-indicator__dot status-indicator__dot--${tone}`} aria-hidden="true" />
      {label ?? t.status[status]}
    </span>
  );
}
