import type { ExecutionSessionStatus } from "@dyo/schemas";
import { isHeartbeatStale } from "../worker/rules.js";

export interface DisplayStatusWorkerSnapshot {
  id: string;
  status: "ONLINE" | "OFFLINE";
  lastHeartbeatAt: Date | null;
  currentJobId: string | null;
}

/** Only the fields needed to tell "the worker's current job is a RENDER job for THIS session" - never a full JobDto. */
export interface DisplayStatusCurrentJob {
  id: string;
  operation: string;
  /** True when this job's own payload.executionSessionId equals the session being displayed - computed by the caller (dispatch-job.ts's own payload shape is the source of truth), never guessed here. */
  belongsToThisSession: boolean;
}

/**
 * Read-time-only status overlay (multi-scene-accumulation phase, section
 * 8/21) - RENDERING/PAUSED are never written to the execution_sessions
 * row (no background sweeper job exists or is needed): a GET request
 * simply recomputes them fresh from the session's assigned worker's live
 * state, the same "never trust a cached ONLINE value alone" principle
 * dispatch-job.ts already applies. Only overlays a NON-terminal, non-
 * AWAITING_PREVIEW_APPROVAL persisted status (a session mid-render still
 * shows RENDERING even though its persisted status is READY_TO_RENDER; a
 * COMPLETED/FAILED session is never overlaid - those are real, final
 * outcomes).
 */
export function deriveExecutionSessionDisplayStatus(
  persistedStatus: ExecutionSessionStatus,
  worker: DisplayStatusWorkerSnapshot | null,
  currentJob: DisplayStatusCurrentJob | null,
  now: Date,
  staleAfterMs: number
): ExecutionSessionStatus {
  if (persistedStatus === "COMPLETED" || persistedStatus === "FAILED") {
    return persistedStatus;
  }

  const workerOnline = worker !== null && worker.status === "ONLINE" && !isHeartbeatStale(worker.lastHeartbeatAt, now, staleAfterMs);
  if (!workerOnline) {
    return "PAUSED";
  }

  if (persistedStatus === "READY_TO_RENDER" && currentJob && currentJob.operation === "RENDER" && currentJob.belongsToThisSession) {
    return "RENDERING";
  }

  return persistedStatus;
}
