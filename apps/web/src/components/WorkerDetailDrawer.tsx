import type { WorkerDto } from "@dyo/schemas";
import type { ReactElement } from "react";
import { formatRelativeTime } from "../lib/relative-time";
import { useLocale } from "./LocaleProvider";
import { StatusBadge } from "./StatusBadge";
import { Dialog } from "./ui/Dialog";

export interface WorkerDetailDrawerProps {
  worker: WorkerDto | null;
  onClose: () => void;
}

export function WorkerDetailDrawer({ worker, onClose }: WorkerDetailDrawerProps): ReactElement {
  const { t, locale } = useLocale();

  const workerOffline = worker !== null && worker.status !== "ONLINE";
  // The last real heartbeat carrying this telemetry - never `updatedAt`,
  // which the offline-sweep also bumps (that would make "last known" look
  // freshER than the telemetry actually is).
  const lastKnownAt = worker?.lastHeartbeatAt ? formatRelativeTime(new Date(worker.lastHeartbeatAt), new Date(), locale) : null;

  return (
    <Dialog open={worker !== null} onClose={onClose} title={worker?.name ?? t.workerDetail.fallbackTitle} variant="drawer">
      {worker ? (
        <dl className="detail-list">
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.workerDetail.workerId}</dt>
            <dd className="detail-list__value">
              <code>{worker.workerId}</code>
            </dd>
          </div>
          {/* Worker -> After Effects / ae-mcp bridge: grouped and indented so
              the dependency is visually obvious (AE/MCP can never be more
              current than the Worker's own connectivity). */}
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.workerDetail.status}</dt>
            <dd className="detail-list__value">
              <StatusBadge status={worker.status} />
            </dd>
          </div>
          {workerOffline ? <p className="field__hint">{t.workerDetail.offlineNotice}</p> : null}
          <div className="detail-list__row detail-list__row--nested">
            <dt className="detail-list__label">{t.workerDetail.afterEffects}</dt>
            <dd className="detail-list__value">
              <StatusBadge status={worker.aeAvailability} />
              {workerOffline && worker.aeStatus !== "UNKNOWN" && lastKnownAt ? (
                <p className="field__hint">{t.workerDetail.lastKnown(t.status[worker.aeStatus], lastKnownAt)}</p>
              ) : null}
            </dd>
          </div>
          <div className="detail-list__row detail-list__row--nested">
            <dt className="detail-list__label">{t.workerDetail.mcp}</dt>
            <dd className="detail-list__value">
              <StatusBadge status={worker.mcpAvailability} />
              {workerOffline && worker.mcpStatus !== "UNKNOWN" && lastKnownAt ? (
                <p className="field__hint">{t.workerDetail.lastKnown(t.status[worker.mcpStatus], lastKnownAt)}</p>
              ) : null}
            </dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.workerDetail.aeVersion}</dt>
            <dd className="detail-list__value">{worker.aeVersion ?? "—"}</dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.workerDetail.maxConcurrency}</dt>
            <dd className="detail-list__value">{worker.maxConcurrency}</dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.workerDetail.currentJob}</dt>
            <dd className="detail-list__value">{worker.currentJobId ? <code>{worker.currentJobId}</code> : "—"}</dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.workerDetail.capabilities}</dt>
            <dd className="detail-list__value">{worker.capabilities.length > 0 ? worker.capabilities.join(", ") : "—"}</dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.workerDetail.lastHeartbeat}</dt>
            <dd className="detail-list__value">
              {worker.lastHeartbeatAt ? (
                <time dateTime={worker.lastHeartbeatAt}>{formatRelativeTime(new Date(worker.lastHeartbeatAt), new Date(), locale)}</time>
              ) : (
                t.common.never
              )}
            </dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.workerDetail.registered}</dt>
            <dd className="detail-list__value">
              <time dateTime={worker.createdAt}>{formatRelativeTime(new Date(worker.createdAt), new Date(), locale)}</time>
            </dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.workerDetail.lastUpdated}</dt>
            <dd className="detail-list__value">
              <time dateTime={worker.updatedAt}>{formatRelativeTime(new Date(worker.updatedAt), new Date(), locale)}</time>
            </dd>
          </div>
        </dl>
      ) : null}
    </Dialog>
  );
}
