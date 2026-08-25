"use client";

import type { ReactElement } from "react";
import { PageHeader } from "./ui/PageHeader";
import { useLocale } from "./LocaleProvider";
import { PendingPanel } from "./ui/PendingPanel";

export function ActivityPage(): ReactElement {
  const { t } = useLocale();

  return (
    <>
      <PageHeader title={t.activity.title} description={t.activity.description} />
      <PendingPanel title={t.activity.pendingTitle} description={t.activity.pendingDescription} />
    </>
  );
}
