import type { JobDto } from "@dyo/schemas";
import { executeJob, type JobDispatcherDeps, type JobExecutionResult } from "./job-dispatcher.js";
import type { JobExecutionRegistry } from "../runtime/job-execution-registry.js";

export interface JobWatchdogLogger {
  info: (meta: Record<string, unknown>, message: string) => void;
  warn: (meta: Record<string, unknown>, message: string) => void;
}

/** Must match heroic-swan-mcp-client.ts's own DEFAULT_TIMEOUT_MS - the per-call bound every plain (non-retried) ae_get_layer/ae_get_composition/ae_capture_frame call in heroic-swan-scene-evidence-inspector.ts is already subject to. */
export const WATCHDOG_PER_CALL_TIMEOUT_MS = 15_000;
/** Same bound as an ordinary MCP call - connect() performs the initialize handshake under this client's own timeoutMs. */
export const WATCHDOG_CONNECT_TIMEOUT_MS = 15_000;
/**
 * Real production incident (2026-09-04, job c19a2fb9): even every one of a
 * job's sequential MCP calls timing out at its own bound is not, by
 * itself, proof of a hang - a real capture/layer read can legitimately be
 * slower than the raw per-call ceiling. 2x over the full worst-case-if-
 * everything-timed-out bound leaves generous headroom for that, while
 * still catching a genuine hang: the real incident this responds to ran
 * roughly 4x its own worst-case bound with zero signal of progress.
 */
export const WATCHDOG_SAFETY_MARGIN_MULTIPLIER = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Derives a bounded upper-bound duration (ms) for the given job, or null if
 * this operation has no watchdog yet - a deliberate, explicit opt-in per
 * operation rather than one arbitrary bound applied everywhere (EXECUTE_FRAME/
 * RENDER can legitimately run for a long time and need their own,
 * separately-considered budgets - see this module's own doc comment).
 *
 * INSPECT_SCENE_EVIDENCE's structure (heroic-swan-scene-evidence-inspector.ts):
 * one ae_get_composition call, one ae_get_layer call per requested layer
 * index, and (only if previewTimestampSeconds is not null) one
 * ae_capture_frame call - each individually bounded by the MCP client's own
 * per-call timeout, connect() bounded separately. The worst case if EVERY
 * call timed out is connect + callCount * per-call timeout; this returns
 * WATCHDOG_SAFETY_MARGIN_MULTIPLIER times that.
 */
export function deriveWatchdogBudgetMs(job: Pick<JobDto, "operation" | "payload">): number | null {
  if (job.operation !== "INSPECT_SCENE_EVIDENCE") {
    return null;
  }
  const payload = job.payload as { layerIndices?: unknown; previewTimestampSeconds?: unknown } | null | undefined;
  const layerCount = Array.isArray(payload?.layerIndices) ? payload.layerIndices.length : 0;
  const hasPreviewCapture = Boolean(payload) && "previewTimestampSeconds" in (payload as object) && payload?.previewTimestampSeconds !== null;
  const callCount = 1 /* ae_get_composition */ + layerCount + (hasPreviewCapture ? 1 : 0);
  const worstCaseMs = WATCHDOG_CONNECT_TIMEOUT_MS + callCount * WATCHDOG_PER_CALL_TIMEOUT_MS;
  return worstCaseMs * WATCHDOG_SAFETY_MARGIN_MULTIPLIER;
}

/**
 * Wraps job-dispatcher.ts's executeJob with an operation-level watchdog
 * (P2, 2026-09-04) - the real gap closed here: job c19a2fb9
 * (INSPECT_SCENE_EVIDENCE, 16 layers) ran RUNNING for 20+ minutes with
 * nothing to ever stop it, blocking every other job under
 * maxConcurrency=1.
 *
 * Registers the job with `registry` for its whole lifetime so a real
 * HeroicSwanMcpClient constructed deep inside the operation's own
 * inspector can be found and terminated (see job-execution-registry.ts).
 * If the derived budget is exceeded: aborts every owned MCP child process
 * for this job (bounded, proof-checked - see HeroicSwanMcpClient.terminate()),
 * then reports a typed WATCHDOG_TIMEOUT failure - but ONLY once
 * termination is actually confirmed. If it could not be confirmed (an
 * "unconfirmed" outcome), this deliberately throws instead of returning a
 * result: job-cycle.ts's own contract treats a thrown executeJob as
 * "never report a status" (see its own doc comment), so the job stays
 * RUNNING in the API's DB rather than being marked terminal while its
 * owned execution might still be alive (P3's core safety requirement) -
 * and this registry's active-job slot is deliberately left set (never
 * endJob()'d) so this same worker process refuses to execute anything
 * else until restarted with confirmed cleanup (see
 * deploy/windows-worker/DYO-Worker-Recover.ps1).
 */
export async function executeJobWithWatchdog(
  deps: JobDispatcherDeps,
  job: JobDto,
  registry: JobExecutionRegistry,
  logger?: JobWatchdogLogger,
  /** Test-only override for the derived budget above - production always uses deriveWatchdogBudgetMs(job) when this is omitted, same "test-only override" convention as heroic-swan-template-inspector.ts's mcpTimeoutMs/openProjectOptions. */
  budgetMsOverride?: number
): Promise<JobExecutionResult> {
  registry.beginJob({ jobId: job.jobId, operation: job.operation });
  const budgetMs = budgetMsOverride ?? deriveWatchdogBudgetMs(job);
  const executionPromise = executeJob(deps, job);

  if (budgetMs === null) {
    try {
      return await executionPromise;
    } finally {
      registry.endJob(job.jobId);
    }
  }

  const raced = await Promise.race([
    executionPromise.then((result) => ({ kind: "completed" as const, result })),
    sleep(budgetMs).then(() => ({ kind: "timed_out" as const }))
  ]);

  if (raced.kind === "completed") {
    registry.endJob(job.jobId);
    return raced.result;
  }

  logger?.warn(
    { jobId: job.jobId, operation: job.operation, budgetMs },
    "job watchdog: operation exceeded its bounded duration - aborting and terminating its owned MCP child process(es)"
  );
  const outcomes = await registry.abortActiveJob(`watchdog: ${job.operation} exceeded its ${budgetMs}ms bounded duration`);
  // The original execution promise is no longer authoritative once the
  // watchdog has already decided this job's outcome - but it must never
  // become an unhandled rejection either. Terminating its owned MCP
  // client(s) above typically makes it settle quickly on its own (any
  // pending callTool() rejects once the transport closes).
  executionPromise.catch(() => {});

  const anyUnconfirmed = outcomes.some((outcome) => outcome.outcome === "unconfirmed");
  if (anyUnconfirmed) {
    logger?.warn(
      { jobId: job.jobId, operation: job.operation, budgetMs, outcomes },
      "job watchdog: could not confirm the owned ae-mcp process actually stopped - refusing to report a terminal job status, and refusing to run any further job on this worker process until it is restarted with confirmed cleanup"
    );
    // Deliberately no registry.endJob() here - see this function's own
    // doc comment.
    throw new Error(
      `Watchdog aborted ${job.operation} (job ${job.jobId}) after ${budgetMs}ms, but its owned ae-mcp child process could not be confirmed stopped - refusing to report a terminal job status until that is certain.`
    );
  }

  registry.endJob(job.jobId);
  return {
    status: "FAILED",
    error: {
      code: "WATCHDOG_TIMEOUT",
      message: `Operation exceeded its ${budgetMs}ms bounded duration and was aborted; its owned ae-mcp process was confirmed stopped.`
    }
  };
}
