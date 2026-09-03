import type pino from "pino";
import { nextBackoffDelayMs, type BackoffPolicy } from "../infrastructure/backoff.js";
import type { ToolCallResult } from "./heroic-swan-mcp-client.js";

/**
 * P1 fix (2026-09-03, real production incident): a real client job proved
 * `ae_get_project_info` AND `ae_list_compositions` can both genuinely time
 * out (MCP error -32001: Request timed out) mid-inspection, independent of
 * the AE/MCP heartbeat-level health check - see
 * DYO-Worker-Final-Update.ps1's own `$AeMcpHealthWindowSeconds` doc comment
 * for the real, preserved-log evidence that this exact machine's MCP
 * bridge can be transiently slow for up to ~320 seconds. A single failed
 * call previously fell straight back to a raw_capture with no retry at
 * all - this bounded retry gives a genuinely transient timeout a real
 * chance to resolve, WITHOUT ever making one inspection tool call wait
 * anywhere close to that multi-minute window - that window governs a
 * completely different decision (the UPDATER deciding whether a
 * just-restarted worker is healthy), never an individual inspection call.
 *
 * Only retries a `TRANSPORT_ERROR` - the MCP layer's own classification
 * for a connection/timeout failure (see heroic-swan-mcp-client.ts). A
 * `TOOL_ERROR` (AE/ae-mcp itself deterministically reporting a real
 * failure, e.g. a validation/schema mismatch surfaced as a tool error) or
 * `NOT_CONNECTED` (a structural bug, not a transient condition) are never
 * retried - retrying either would mask a real deterministic failure or
 * spin uselessly against a connection that is already gone.
 */
export const MCP_FUNCTIONAL_RETRY_POLICY: BackoffPolicy = { baseMs: 2_000, maxMs: 8_000 };
export const MCP_FUNCTIONAL_RETRY_MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TransientRetryOptions {
  maxAttempts?: number;
  policy?: BackoffPolicy;
}

/**
 * Runs `attempt` up to `maxAttempts` times, retrying only on a transient
 * `TRANSPORT_ERROR`, with bounded exponential backoff between attempts
 * (reusing the SAME shared backoff policy every other retry in this
 * worker uses - see infrastructure/backoff.ts). Every retry (and the
 * final exhausted-budget outcome) is logged with the operation name,
 * attempt number, and reason, when a logger is provided. Never fabricates
 * success - if every attempt fails, the last real failure is returned
 * exactly as reported, never swallowed or replaced with a generic message.
 */
export async function callWithTransientRetry(
  operationName: string,
  logger: pino.Logger | undefined,
  attempt: () => Promise<ToolCallResult>,
  options: TransientRetryOptions = {}
): Promise<ToolCallResult> {
  const maxAttempts = options.maxAttempts ?? MCP_FUNCTIONAL_RETRY_MAX_ATTEMPTS;
  const policy = options.policy ?? MCP_FUNCTIONAL_RETRY_POLICY;

  let lastResult: ToolCallResult = {
    ok: false,
    error: { code: "TRANSPORT_ERROR", message: "no attempt was made (maxAttempts must be at least 1)" }
  };
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    const result = await attempt();
    if (result.ok || result.error.code !== "TRANSPORT_ERROR") {
      return result;
    }
    lastResult = result;
    if (attemptNumber < maxAttempts) {
      logger?.warn(
        { operation: operationName, attempt: attemptNumber, maxAttempts, reason: result.error.message },
        "transient MCP transport error, retrying"
      );
      await sleep(nextBackoffDelayMs(attemptNumber, policy));
    } else {
      logger?.warn(
        { operation: operationName, attempt: attemptNumber, maxAttempts, reason: result.error.message },
        "transient MCP transport error, retry budget exhausted"
      );
    }
  }
  return lastResult;
}
