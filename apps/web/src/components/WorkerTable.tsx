import type { AeStatus, McpStatus, WorkerDto, WorkerStatus } from "@dyo/schemas";
import type { ReactElement } from "react";
import type { Dictionary } from "../lib/i18n/dictionaries";
import type { Locale } from "../lib/i18n/locale";
import { formatRelativeTime } from "../lib/relative-time";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";
import { StatusBadge } from "./StatusBadge";

/**
 * Secondary-only metadata (never the primary badge - see StatusBadge's own
 * aeAvailability/mcpAvailability usage above) surfacing what AE/MCP last
 * reported while the Worker itself was still online, so it's never
 * confused with current truth. Omitted entirely once there is nothing
 * meaningful to show (the Worker is online, or it never reported anything
 * but UNKNOWN, or it has never had a heartbeat at all).
 */
function lastKnownTitle(
  workerStatus: WorkerStatus,
  reported: AeStatus | McpStatus,
  lastHeartbeatAt: string | null,
  now: Date,
  locale: Locale,
  t: Dictionary
): string | undefined {
  if (workerStatus === "ONLINE" || reported === "UNKNOWN" || !lastHeartbeatAt) {
    return undefined;
  }
  return t.workerDetail.lastKnown(t.status[reported], formatRelativeTime(new Date(lastHeartbeatAt), now, locale));
}

export interface WorkerTableProps {
  /** null means the worker list could not be fetched/parsed - distinct from an empty (but valid) list. */
  workers: WorkerDto[] | null;
  now?: Date;
  onSelectWorker?: (worker: WorkerDto) => void;
}

export function WorkerTable({ workers, now = new Date(), onSelectWorker }: WorkerTableProps): ReactElement {
  const { t, locale } = useLocale();

  if (workers === null) {
    return <ErrorState title={t.workers.dataUnavailableTitle} description={t.workers.dataUnavailableDescription} />;
  }

  if (workers.length === 0) {
    return <EmptyState title={t.workers.emptyTitle} description={t.workers.emptyDescription} />;
  }

  return (
    <div className="table-scroll">
      <table>
        <caption className="visually-hidden">{t.workers.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.workers.nameColumn}</th>
            <th scope="col">{t.workers.statusColumn}</th>
            <th scope="col">{t.workers.aeStatusColumn}</th>
            <th scope="col">{t.workers.mcpStatusColumn}</th>
            <th scope="col">{t.workers.aeVersionColumn}</th>
            <th scope="col">{t.workers.maxConcurrencyColumn}</th>
            <th scope="col">{t.workers.currentJobColumn}</th>
            <th scope="col">{t.workers.capabilitiesColumn}</th>
            <th scope="col">{t.workers.lastHeartbeatColumn}</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((worker) => (
            <tr
              key={worker.workerId}
              data-clickable={onSelectWorker ? "true" : undefined}
              tabIndex={onSelectWorker ? 0 : undefined}
              onClick={onSelectWorker ? () => onSelectWorker(worker) : undefined}
              onKeyDown={
                onSelectWorker
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectWorker(worker);
                      }
                    }
                  : undefined
              }
              aria-label={onSelectWorker ? t.workers.viewDetailsAriaLabel(worker.name) : undefined}
            >
              <th scope="row">{worker.name}</th>
              <td>
                <StatusBadge status={worker.status} />
              </td>
              <td title={lastKnownTitle(worker.status, worker.aeStatus, worker.lastHeartbeatAt, now, locale, t)}>
                <StatusBadge status={worker.aeAvailability} />
              </td>
              <td title={lastKnownTitle(worker.status, worker.mcpStatus, worker.lastHeartbeatAt, now, locale, t)}>
                <StatusBadge status={worker.mcpAvailability} />
              </td>
              <td>{worker.aeVersion ?? "—"}</td>
              <td>{worker.maxConcurrency}</td>
              <td>{worker.currentJobId ? <code>{worker.currentJobId}</code> : "—"}</td>
              <td>{worker.capabilities.length > 0 ? worker.capabilities.join(", ") : "—"}</td>
              <td>
                {worker.lastHeartbeatAt ? (
                  <time dateTime={worker.lastHeartbeatAt}>
                    {formatRelativeTime(new Date(worker.lastHeartbeatAt), now, locale)}
                  </time>
                ) : (
                  t.common.never
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
