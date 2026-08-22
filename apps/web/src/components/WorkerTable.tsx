import type { WorkerDto } from "@dyo/schemas";
import type { ReactElement } from "react";
import { formatRelativeTime } from "../lib/relative-time";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { StatusBadge } from "./StatusBadge";

export interface WorkerTableProps {
  /** null means the worker list could not be fetched/parsed - distinct from an empty (but valid) list. */
  workers: WorkerDto[] | null;
  now?: Date;
}

export function WorkerTable({ workers, now = new Date() }: WorkerTableProps): ReactElement {
  if (workers === null) {
    return (
      <ErrorState
        title="Worker data unavailable"
        description="Could not load worker records from the API."
      />
    );
  }

  if (workers.length === 0) {
    return (
      <EmptyState
        title="No workers registered"
        description="Once a Windows worker pairs with the API, it will appear here."
      />
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <caption className="visually-hidden">Registered workers</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Worker ID</th>
            <th scope="col">Status</th>
            <th scope="col">AE status</th>
            <th scope="col">MCP status</th>
            <th scope="col">AE version</th>
            <th scope="col">Capabilities</th>
            <th scope="col">Max concurrency</th>
            <th scope="col">Current job</th>
            <th scope="col">Last heartbeat</th>
            <th scope="col">Last updated</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((worker) => (
            <tr key={worker.workerId}>
              <th scope="row">{worker.name}</th>
              <td>
                <code>{worker.workerId}</code>
              </td>
              <td>
                <StatusBadge status={worker.status} />
              </td>
              <td>
                <StatusBadge status={worker.aeStatus} />
              </td>
              <td>
                <StatusBadge status={worker.mcpStatus} />
              </td>
              <td>{worker.aeVersion ?? "—"}</td>
              <td>{worker.capabilities.length > 0 ? worker.capabilities.join(", ") : "—"}</td>
              <td>{worker.maxConcurrency}</td>
              <td>{worker.currentJobId ?? "—"}</td>
              <td>
                {worker.lastHeartbeatAt ? (
                  <time dateTime={worker.lastHeartbeatAt}>
                    {formatRelativeTime(new Date(worker.lastHeartbeatAt), now)}
                  </time>
                ) : (
                  "never"
                )}
              </td>
              <td>
                <time dateTime={worker.updatedAt}>{formatRelativeTime(new Date(worker.updatedAt), now)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
