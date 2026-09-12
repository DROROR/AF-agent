import type { DispatchJobRequest } from "@dyo/schemas";

/**
 * Rate limits for the remote-diagnostics operations (2026-09-12).
 *
 * These are not abuse limits against a hostile caller - every caller here is
 * already session-authenticated. They exist because a diagnostic runs ON the
 * production worker and occupies its single job slot (maxConcurrency = 1,
 * CLAUDE.md). An unbounded diagnostic loop would starve real render work
 * while looking, from the dashboard, like the worker was simply busy.
 *
 * RESTART is far tighter than the read-only limit: a restart that is retried
 * in a loop is indistinguishable from a crash loop, and would defeat the
 * supervisor's own restart backoff.
 */
export interface DiagnosticRateLimit {
  maxInWindow: number;
  windowMs: number;
}

export const DIAGNOSTIC_RATE_LIMITS = {
  RUN_DIAGNOSTIC: { maxInWindow: 20, windowMs: 10 * 60 * 1000 },
  RESTART_WORKER_SAFE: { maxInWindow: 3, windowMs: 30 * 60 * 1000 }
} as const satisfies Record<string, DiagnosticRateLimit>;

export type DiagnosticOperation = keyof typeof DIAGNOSTIC_RATE_LIMITS;

export function isDiagnosticOperation(operation: DispatchJobRequest["operation"]): operation is DiagnosticOperation {
  return operation in DIAGNOSTIC_RATE_LIMITS;
}
