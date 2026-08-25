"use client";

import { Activity, Cpu, Database, ListTodo, Server, Wand2 } from "lucide-react";
import type { ReactElement } from "react";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";
import { StatusBadge, type BadgeStatus } from "./StatusBadge";
import { Card } from "./ui/Card";
import { PageHeader } from "./ui/PageHeader";
import { PendingPanel } from "./ui/PendingPanel";
import { Skeleton } from "./ui/Skeleton";
import { computeOverviewMetrics } from "../lib/overview-metrics";
import { formatRelativeTime } from "../lib/relative-time";

function healthBadgeStatus(value: "ok" | "error" | "unknown"): BadgeStatus {
  if (value === "ok") {
    return "OK";
  }
  if (value === "error") {
    return "ERROR";
  }
  return "UNKNOWN";
}

export function OverviewPage(): ReactElement {
  const { t, locale } = useLocale();
  const { data, isInitialLoading, lastError } = useDashboardStatusContext();

  if (isInitialLoading) {
    return (
      <>
        <PageHeader title={t.overview.title} description={t.overview.description} />
        <div className="card-grid" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <div className="stat-card">
                <Skeleton width="60%" height="0.85rem" />
                <Skeleton width="40%" height="1.75rem" />
              </div>
            </Card>
          ))}
        </div>
        <p role="status" className="loading-indicator">
          {t.overview.loading}
        </p>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title={t.overview.title} description={t.overview.description} />
        <ErrorState title={t.overview.unavailableTitle} description={lastError ?? t.common.unavailableFallback} />
      </>
    );
  }

  const metrics = computeOverviewMetrics(data.workers ?? []);

  return (
    <>
      <PageHeader title={t.overview.title} description={t.overview.description} />
      {lastError ? (
        <p role="status" className="stale-notice">
          {t.common.staleNotice(lastError)}
        </p>
      ) : null}

      <div className="card-grid">
        <Card>
          <div className="stat-card">
            <span className="stat-card__label">
              <Cpu size={14} aria-hidden="true" /> {t.overview.api}
            </span>
            <span className="stat-card__value">
              <StatusBadge status={healthBadgeStatus(data.api)} />
            </span>
          </div>
        </Card>
        <Card>
          <div className="stat-card">
            <span className="stat-card__label">
              <Database size={14} aria-hidden="true" /> {t.overview.database}
            </span>
            <span className="stat-card__value">
              <StatusBadge status={healthBadgeStatus(data.database)} />
            </span>
          </div>
        </Card>
        <Card>
          <div className="stat-card">
            <span className="stat-card__label">
              <Server size={14} aria-hidden="true" /> {t.overview.workersOnline}
            </span>
            <span className="stat-card__value">
              {data.workers === null ? "—" : `${metrics.workersOnline} / ${metrics.workersTotal}`}
            </span>
          </div>
        </Card>
        <Card>
          <div className="stat-card">
            <span className="stat-card__label">
              <Wand2 size={14} aria-hidden="true" /> {t.overview.aeOnline}
            </span>
            <span className="stat-card__value">{data.workers === null ? "—" : metrics.aeOnline}</span>
          </div>
        </Card>
        <Card>
          <div className="stat-card">
            <span className="stat-card__label">
              <Activity size={14} aria-hidden="true" /> {t.overview.mcpOnline}
            </span>
            <span className="stat-card__value">{data.workers === null ? "—" : metrics.mcpOnline}</span>
          </div>
        </Card>
        <Card>
          <div className="stat-card">
            <span className="stat-card__label">
              <ListTodo size={14} aria-hidden="true" /> {t.overview.activeJobs}
            </span>
            <span className="stat-card__value">{data.workers === null ? "—" : metrics.activeJobs.length}</span>
            <span className="stat-card__meta">
              {metrics.mostRecentHeartbeatAt
                ? t.overview.lastHeartbeat(formatRelativeTime(new Date(metrics.mostRecentHeartbeatAt), new Date(), locale))
                : t.overview.noHeartbeat}
            </span>
          </div>
        </Card>
      </div>

      <Card>
        <div className="card__header">
          <h2>{t.overview.queueOverview}</h2>
        </div>
        <PendingPanel title={t.overview.queuePendingTitle} description={t.overview.queuePendingDescription} />
      </Card>
    </>
  );
}
