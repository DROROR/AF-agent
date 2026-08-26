import type { PlanStatus } from "@dyo/schemas";
import type { ReactElement } from "react";
import { useLocale } from "./LocaleProvider";
import type { Tone } from "./StatusBadge";

const PLAN_STATUS_TONE: Record<PlanStatus, Tone> = {
  DRAFT: "neutral",
  APPROVED: "positive",
  REJECTED: "negative"
};

/** Plan-level status badge (DRAFT/APPROVED/REJECTED) - distinct from RowApprovalBadge's per-scene vocabulary. */
export function PlanStatusBadge({ status }: { status: PlanStatus }): ReactElement {
  const { t } = useLocale();
  const tone = PLAN_STATUS_TONE[status];
  return (
    <span className={`status-badge status-badge--${tone}`} data-status={status}>
      {t.planStatus[status]}
    </span>
  );
}
