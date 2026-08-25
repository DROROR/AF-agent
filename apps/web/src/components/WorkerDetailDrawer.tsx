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
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.workerDetail.status}</dt>
            <dd className="detail-list__value">
              <StatusBadge status={worker.status} />
            </dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.workerDetail.afterEffects}</dt>
            <dd className="detail-list__value">
              <StatusBadge status={worker.aeStatus} />
            </dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.workerDetail.mcp}</dt>
            <dd className="detail-list__value">
              <StatusBadge status={worker.mcpStatus} />
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
