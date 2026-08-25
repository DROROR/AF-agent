"use client";

import type { ReactElement } from "react";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";
import { Card } from "./ui/Card";
import { PageHeader } from "./ui/PageHeader";
import { PendingPanel } from "./ui/PendingPanel";
import { Skeleton } from "./ui/Skeleton";
import { computeOverviewMetrics } from "../lib/overview-metrics";

export function JobsPage(): ReactElement {
  const { t } = useLocale();
  const { data, isInitialLoading, lastError } = useDashboardStatusContext();

  if (isInitialLoading) {
    return (
      <>
        <PageHeader title={t.jobs.title} description={t.jobs.description} />
        <Card>
          <Skeleton height="1.5rem" />
        </Card>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title={t.jobs.title} description={t.jobs.description} />
        <ErrorState title={t.jobs.unavailableTitle} description={lastError ?? t.common.unavailableFallback} />
      </>
    );
  }

  const activeJobs = data.workers === null ? null : computeOverviewMetrics(data.workers).activeJobs;

  return (
    <>
      <PageHeader title={t.jobs.title} description={t.jobs.description} />
      {lastError ? (
        <p role="status" className="stale-notice">
          {t.common.staleNotice(lastError)}
        </p>
      ) : null}

      <Card>
        <div className="card__header">
          <h2>{t.jobs.currentlyActive}</h2>
        </div>
        {activeJobs === null ? (
          <ErrorState title={t.jobs.workerDataUnavailableTitle} description={t.jobs.workerDataUnavailableDescription} />
        ) : activeJobs.length === 0 ? (
          <EmptyState title={t.jobs.emptyTitle} description={t.jobs.emptyDescription} />
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">{t.jobs.tableCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.jobs.jobIdColumn}</th>
                  <th scope="col">{t.jobs.workerColumn}</th>
                </tr>
              </thead>
              <tbody>
                {activeJobs.map((job) => (
                  <tr key={job.jobId}>
                    <td>
                      <code>{job.jobId}</code>
                    </td>
                    <td>{job.workerName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <PendingPanel title={t.jobs.pendingTitle} description={t.jobs.pendingDescription} />
    </>
  );
}
