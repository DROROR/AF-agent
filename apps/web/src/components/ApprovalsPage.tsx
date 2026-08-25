"use client";

import type { ReactElement } from "react";
import { PageHeader } from "./ui/PageHeader";
import { Card } from "./ui/Card";
import { useLocale } from "./LocaleProvider";
import { PendingPanel } from "./ui/PendingPanel";
import type { Dictionary } from "../lib/i18n/dictionaries";

const GATE_KEYS: readonly (keyof Dictionary["approvals"]["gates"])[] = [
  "scenePlan",
  "firstFrame",
  "branding",
  "fullPreview",
  "finalRender"
];

/**
 * No approval-gate API exists yet - CLAUDE.md defines these five gates,
 * but nothing server-side tracks their state today. Structure only, per
 * instructions not to fabricate an approval.
 */
export function ApprovalsPage(): ReactElement {
  const { t } = useLocale();

  return (
    <>
      <PageHeader title={t.approvals.title} description={t.approvals.description} />
      <div className="card-grid">
        {GATE_KEYS.map((key) => {
          const gate = t.approvals.gates[key];
          return (
            <Card key={key}>
              <h3>{gate.title}</h3>
              <p className="gate-card__description">{gate.description}</p>
            </Card>
          );
        })}
      </div>
      <PendingPanel title={t.approvals.pendingTitle} description={t.approvals.pendingDescription} />
    </>
  );
}
