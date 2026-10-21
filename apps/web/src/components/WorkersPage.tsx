"use client";

import type { WorkerDto } from "@dyo/schemas";
import { useState, type ReactElement } from "react";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";
import { WorkerDetailDrawer } from "./WorkerDetailDrawer";
import { WorkerTable } from "./WorkerTable";
import { Card } from "./ui/Card";
import { PageHeader } from "./ui/PageHeader";
import { Skeleton } from "./ui/Skeleton";

export function WorkersPage(): ReactElement {
  const { t } = useLocale();
  const { data, isInitialLoading, lastError } = useDashboardStatusContext();
  const [selectedWorker, setSelectedWorker] = useState<WorkerDto | null>(null);

  if (isInitialLoading) {
    return (
      <>
        <PageHeader title={t.workers.title} description={t.workers.description} />
        <Card>
          <Skeleton height="1.5rem" />
        </Card>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title={t.workers.title} description={t.workers.description} />
        <ErrorState title={t.workers.unavailableTitle} description={lastError ?? t.common.unavailableFallback} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t.workers.title} description={t.workers.description} />
      {lastError ? (
        <p role="status" className="stale-notice">
          {t.common.staleNotice(lastError)}
        </p>
      ) : null}
      <Card>
        <WorkerTable workers={data.workers} onSelectWorker={setSelectedWorker} />
      </Card>
      <WorkerDetailDrawer worker={selectedWorker} onClose={() => setSelectedWorker(null)} />
    </>
  );
}
