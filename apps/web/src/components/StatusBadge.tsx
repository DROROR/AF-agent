import type { ReactElement } from "react";
import { useLocale } from "./LocaleProvider";

export type BadgeStatus = "ONLINE" | "OFFLINE" | "UNKNOWN" | "OK" | "ERROR" | "UNAVAILABLE";

export type Tone = "positive" | "negative" | "neutral" | "info";

/**
 * Single source of truth for status tone presentation - see
 * docs/engineering/FRONTEND.md ("centralize status labels/presentation
 * instead of duplicating them"). UNKNOWN is deliberately "neutral", not
 * "negative" - CLAUDE.md Phase 3 task 6 ("UNKNOWN must not be shown as a
 * failure"). Exported so other presentational components (e.g.
 * StatusIndicator's compact dot) reuse the exact same tone mapping rather
 * than redeclaring it. The label itself is NOT part of this map - "Online"/
 * "Offline"/etc are user-facing text and come from the active locale's
 * dictionary (t.status), not a hardcoded English string - see StatusIndicator.tsx.
 *
 * UNAVAILABLE is also deliberately "neutral", not "negative" - it means a
 * downstream signal (AE/ae-mcp bridge) cannot currently be verified because
 * the Worker reporting it is itself offline, never that the signal is
 * confirmed bad - see derive-telemetry-availability.ts on the API side.
 */
export const STATUS_TONE: Record<BadgeStatus, Tone> = {
  ONLINE: "positive",
  OK: "positive",
  OFFLINE: "negative",
  ERROR: "negative",
  UNKNOWN: "neutral",
  UNAVAILABLE: "neutral"
};

export interface StatusBadgeProps {
  status: BadgeStatus;
}

export function StatusBadge({ status }: StatusBadgeProps): ReactElement {
  const { t } = useLocale();
  const tone = STATUS_TONE[status];
  return (
    <span className={`status-badge status-badge--${tone}`} data-status={status}>
      {t.status[status]}
    </span>
  );
}
