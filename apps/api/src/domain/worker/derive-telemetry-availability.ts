import type { AeStatus, McpStatus, TelemetryAvailabilityStatus, WorkerStatus } from "@dyo/schemas";

/**
 * AE/MCP status is reported BY the Worker on its own heartbeat, so it can
 * never be more current than the Worker's own connectivity - see CLAUDE.md
 * safety rule 9 ("pause safely instead of endless retries" - the display
 * analogue is "never show a confirmed state you cannot currently verify").
 *
 * `workerStatus` is already the freshness-correct value by the time this
 * runs: record-heartbeat.ts always writes status="ONLINE" fresh on every
 * real heartbeat, and list-workers.ts/get-worker.ts always sweep stale
 * workers to OFFLINE (sweep-stale-workers.ts) before ever reading a row -
 * so no separate now/staleAfterMs check belongs at this layer.
 *
 * markStaleWorkersOffline never touches aeStatus/mcpStatus (never mutates
 * historical telemetry) - once a Worker goes offline, its last-reported
 * aeStatus/mcpStatus stays frozen at whatever it last said. That frozen
 * value must never be surfaced as current truth: it becomes UNAVAILABLE
 * here, and the raw value remains readable separately (WorkerDto's own
 * aeStatus/mcpStatus fields) purely as "last known" secondary metadata.
 */
export function deriveTelemetryAvailability(
  workerStatus: WorkerStatus,
  reportedStatus: AeStatus | McpStatus
): TelemetryAvailabilityStatus {
  return workerStatus === "ONLINE" ? reportedStatus : "UNAVAILABLE";
}
