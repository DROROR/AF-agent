import type { RowApprovalState } from "@dyo/schemas";
import type { ReactElement } from "react";
import { useLocale } from "./LocaleProvider";
import type { Tone } from "./StatusBadge";

/**
 * Per-scene review-state badge (Phase 6's RowApprovalState) - a distinct
 * vocabulary from worker/job health (StatusBadge's BadgeStatus), so this
 * is its own small component rather than overloading StatusBadge with an
 * unrelated status set. Reuses the exact same `.status-badge` CSS classes
 * and tone system - no new styling system.
 */
const ROW_APPROVAL_TONE: Record<RowApprovalState, Tone> = {
  UNREVIEWED: "neutral",
  NEEDS_MAPPING: "neutral",
  READY_FOR_APPROVAL: "info",
  APPROVED: "positive",
  REJECTED: "negative"
};

export function RowApprovalBadge({ state }: { state: RowApprovalState }): ReactElement {
  const { t } = useLocale();
  const tone = ROW_APPROVAL_TONE[state];
  return (
    <span className={`status-badge status-badge--${tone}`} data-status={state}>
      {t.rowApprovalState[state]}
    </span>
  );
}
