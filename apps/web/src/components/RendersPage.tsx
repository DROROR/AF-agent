"use client";

import { Download, Play } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { PageHeader } from "./ui/PageHeader";
import { useLocale } from "./LocaleProvider";
import { PendingPanel } from "./ui/PendingPanel";
import type { Dictionary } from "../lib/i18n/dictionaries";

const OUTPUT_KEYS: readonly (keyof Dictionary["renders"]["outputs"])[] = ["landscape", "reels"];

/**
 * No render-job API exists yet - actions are visibly present (per the
 * requested layout) but disabled, since CLAUDE.md requires "only enable
 * actions when real backend support exists".
 */
export function RendersPage(): ReactElement {
  const { t } = useLocale();

  return (
    <>
      <PageHeader title={t.renders.title} description={t.renders.description} />
      <div className="card-grid">
        {OUTPUT_KEYS.map((key) => {
          const output = t.renders.outputs[key];
          return (
            <Card key={key}>
              <div className="card__header">
                <h2>{output.title}</h2>
              </div>
              <p className="gate-card__description">{output.description}</p>
              <div className="render-card__actions">
                <Button variant="secondary" size="sm" disabled title={t.renders.noRenderTitle}>
                  <Play aria-hidden="true" />
                  {t.renders.preview}
                </Button>
                <Button variant="secondary" size="sm" disabled title={t.renders.noRenderTitle}>
                  <Download aria-hidden="true" />
                  {t.renders.download}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
      <PendingPanel title={t.renders.pendingTitle} description={t.renders.pendingDescription} />
    </>
  );
}
