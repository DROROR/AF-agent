import type { ReactElement } from "react";
import type { ComponentHealth } from "../lib/dashboard-types";
import { StatusBadge, type BadgeStatus } from "./StatusBadge";

export interface SystemHealthCardProps {
  api: "ok" | "error";
  database: ComponentHealth;
}

function toBadgeStatus(value: ComponentHealth | "ok" | "error"): BadgeStatus {
  if (value === "ok") {
    return "OK";
  }
  if (value === "error") {
    return "ERROR";
  }
  return "UNKNOWN";
}

export function SystemHealthCard({ api, database }: SystemHealthCardProps): ReactElement {
  return (
    <section aria-labelledby="system-health-heading" className="card">
      <h2 id="system-health-heading">System</h2>
      <dl className="status-list">
        <div className="status-list__row">
          <dt>API</dt>
          <dd>
            <StatusBadge status={toBadgeStatus(api)} />
          </dd>
        </div>
        <div className="status-list__row">
          <dt>Database</dt>
          <dd>
            <StatusBadge status={toBadgeStatus(database)} />
          </dd>
        </div>
      </dl>
    </section>
  );
}
