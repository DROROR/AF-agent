"use client";

import type { ReactElement } from "react";
import { useDashboardStatus } from "../lib/use-dashboard-status";
import { ErrorState } from "./ErrorState";
import { SystemHealthCard } from "./SystemHealthCard";
import { WorkerTable } from "./WorkerTable";

export function Dashboard(): ReactElement {
  const { data, isInitialLoading, lastError } = useDashboardStatus();

  if (isInitialLoading) {
    return (
      <p role="status" className="loading-indicator">
        Loading dashboard…
      </p>
    );
  }

  if (!data) {
    return (
      <ErrorState
        title="Dashboard unavailable"
        description={lastError ?? "Could not load dashboard data."}
      />
    );
  }

  return (
    <div className="dashboard">
      <SystemHealthCard api={data.api} database={data.database} />
      {lastError ? (
        <p role="status" className="stale-notice">
          Live updates paused - retrying… ({lastError})
        </p>
      ) : null}
      <section aria-labelledby="workers-heading" className="card">
        <h2 id="workers-heading">Workers</h2>
        <WorkerTable workers={data.workers} />
      </section>
    </div>
  );
}
