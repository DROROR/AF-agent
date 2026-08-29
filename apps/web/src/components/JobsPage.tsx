"use client";

import type { ReactElement } from "react";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";
import { Card } from "./ui/Card";
import { PageHeader } from "./ui/PageHeader";
import { Skeleton } from "./ui/Skeleton";
import { computeOverviewMetrics } from "../lib/overview-metrics";
import { useJobHistory } from "../lib/use-job-history";

/** Job history + errors (2026-08-29 closure requirement) - a dedicated card below "Currently active", covering completed/failed/in-progress jobs so no DB/curl access is ever needed to understand what happened. */
function JobHistorySection(): ReactElement {
  const { t } = useLocale();
  const { jobs, isLoading, error } = useJobHistory();

  return (
    <Card>
      <div className="card__header">
        <h2>{t.jobs.historyTitle}</h2>
        <p>{t.jobs.historyDescription}</p>
      </div>
      {isLoading ? (
        <Skeleton height="1.5rem" />
      ) : error ? (
        <ErrorState title={t.jobs.historyUnavailableTitle} description={error} />
      ) : !jobs || jobs.length === 0 ? (
        <EmptyState title={t.jobs.historyEmptyTitle} description={t.jobs.historyEmptyDescription} />
      ) : (
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">{t.jobs.historyTableCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{t.jobs.jobIdColumn}</th>
                <th scope="col">{t.jobs.operationColumn}</th>
                <th scope="col">{t.jobs.statusColumn}</th>
                <th scope="col">{t.jobs.workerColumn}</th>
                <th scope="col">{t.jobs.projectColumn}</th>
                <th scope="col">{t.jobs.sessionColumn}</th>
                <th scope="col">{t.jobs.createdColumn}</th>
                <th scope="col">{t.jobs.completedColumn}</th>
                <th scope="col">{t.jobs.reasonColumn}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.jobId}>
                  <td>
                    <code>{job.jobId}</code>
                  </td>
                  <td>{job.operation}</td>
                  <td>{job.status}</td>
                  <td>{job.workerName ?? job.workerId}</td>
                  <td>{job.projectName ?? t.jobs.noProject}</td>
                  <td>{job.executionSessionId ?? t.jobs.noSession}</td>
                  <td>{new Date(job.createdAt).toLocaleString()}</td>
                  <td>{job.completedAt ? new Date(job.completedAt).toLocaleString() : t.jobs.noProject}</td>
                  <td>{job.error?.message ?? t.jobs.noReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

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

      <JobHistorySection />
    </>
  );
}
