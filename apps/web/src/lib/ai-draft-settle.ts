import type { WorkMap } from "@dyo/schemas";
import type { ApiResult } from "./projects-api-client";

/**
 * REAL 2026-10-08, first plugin-free test template on the QA machine: the
 * operator pressed "Claude - Create Video Plan", waited, and was told
 * "Creating your video plan took too long. Please try again." The plan
 * was NOT lost: dyo-api's own log shows the same request finishing 48
 * seconds later (provider time 228 s) and saving work-map revision 1.
 * The browser had simply stopped waiting at its own 180 s, and nginx's
 * 210 s on that route would have cut the connection next. A truthful
 * screen cannot call that a failure, and "try again" would have thrown
 * away the finished plan and started a second, equally slow one.
 *
 * So a draft call that ends without an answer - our own timeout, a
 * gateway timeout, or a dropped connection - is not an answer yet. This
 * keeps watching the project's work map, which the server writes the
 * moment the draft is done, and reports success as soon as a revision
 * newer than the one from before the request appears. The wait is
 * bounded; when it runs out the message says the plan may still arrive
 * and asks for a reload, never "failed". A real refusal (400, 409, 503
 * "not configured"...) is returned as it is, at once - only a request
 * whose outcome is genuinely unknown is waited on.
 */
export const AI_DRAFT_SETTLE_WAIT_MS = 600_000;
export const AI_DRAFT_SETTLE_POLL_MS = 5_000;

export const AI_DRAFT_STILL_RUNNING_MESSAGE =
  "Your video plan is still being written on the server. Reload this page in a few minutes to see it - do not start another one.";

/** True when the call ended without the server's answer, so the draft may still finish: our own abort, a gateway timeout, or no response at all. */
export function isAiDraftOutcomeUnknown(result: ApiResult<WorkMap>): boolean {
  if (result.ok) {
    return false;
  }
  if (result.code === "TIMED_OUT") {
    return true;
  }
  return result.status === 0 || result.status === 502 || result.status === 504;
}

export interface SettleAiDraftDeps {
  /** The real POST .../work-map/ai-draft call. */
  post: () => Promise<ApiResult<WorkMap>>;
  /** The real GET .../work-map call - null data is the genuine "no work map yet". */
  poll: () => Promise<ApiResult<WorkMap | null>>;
  sleep: (ms: number) => Promise<void>;
  /** Monotonic clock in ms, injected so a test never has to wait. */
  now: () => number;
  maxWaitMs?: number;
  pollMs?: number;
}

/**
 * Runs the draft call and, when its outcome is unknown, waits (bounded)
 * for the server to write a work map revision newer than `baselineRevision`.
 */
export async function settleAiWorkMapDraft(baselineRevision: number, deps: SettleAiDraftDeps): Promise<ApiResult<WorkMap>> {
  const first = await deps.post();
  if (!isAiDraftOutcomeUnknown(first)) {
    return first;
  }
  const maxWaitMs = deps.maxWaitMs ?? AI_DRAFT_SETTLE_WAIT_MS;
  const pollMs = deps.pollMs ?? AI_DRAFT_SETTLE_POLL_MS;
  const startedAt = deps.now();
  while (deps.now() - startedAt < maxWaitMs) {
    const polled = await deps.poll();
    if (polled.ok && polled.data !== null && polled.data.revision > baselineRevision) {
      return { ok: true, data: polled.data };
    }
    await deps.sleep(pollMs);
  }
  return { ok: false, status: first.ok ? 0 : first.status, code: "STILL_RUNNING", message: AI_DRAFT_STILL_RUNNING_MESSAGE };
}
