import type { ReactElement } from "react";

export type BadgeStatus = "ONLINE" | "OFFLINE" | "UNKNOWN" | "OK" | "ERROR";

type Tone = "positive" | "negative" | "neutral";

/**
 * Single source of truth for status label/tone presentation - see
 * docs/engineering/FRONTEND.md ("centralize status labels/presentation
 * instead of duplicating them"). UNKNOWN is deliberately "neutral", not
 * "negative" - CLAUDE.md Phase 3 task 6 ("UNKNOWN must not be shown as a
 * failure").
 */
const STATUS_PRESENTATION: Record<BadgeStatus, { label: string; tone: Tone }> = {
  ONLINE: { label: "Online", tone: "positive" },
  OK: { label: "OK", tone: "positive" },
  OFFLINE: { label: "Offline", tone: "negative" },
  ERROR: { label: "Error", tone: "negative" },
  UNKNOWN: { label: "Unknown", tone: "neutral" }
};

export interface StatusBadgeProps {
  status: BadgeStatus;
}

export function StatusBadge({ status }: StatusBadgeProps): ReactElement {
  const { label, tone } = STATUS_PRESENTATION[status];
  return (
    <span className={`status-badge status-badge--${tone}`} data-status={status}>
      {label}
    </span>
  );
}
