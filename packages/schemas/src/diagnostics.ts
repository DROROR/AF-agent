import { z } from "zod";

/**
 * REMOTE WINDOWS DIAGNOSTICS (2026-09-12).
 *
 * Every incident in this project so far has been diagnosed by a human
 * copy-pasting PowerShell output. That is not a protocol - it is slow, it
 * loses evidence, and it puts the operator in the critical path of every
 * retry. These operations move that evidence onto the SAME outbound,
 * token-authenticated channel the worker already uses for jobs: the worker
 * polls, claims, executes, and reports. No inbound port, no public IP, no
 * RDP/AnyDesk, no router change - CLAUDE.md's Production Connection Model is
 * preserved exactly.
 *
 * DESIGN: two capabilities, not eight, split on the only axis that matters
 * for authorization - read-only evidence gathering (RUN_DIAGNOSTIC) versus a
 * real mutation of the running system (RESTART_WORKER_SAFE). The eight
 * operation names the mandate specifies are preserved verbatim as the closed
 * `kind` enum below, so the allowlist is still exact and a caller can still
 * never name anything outside it (CLAUDE.md Safety Rule 2). Collapsing the
 * seven read-only ones into one capability means ONE audit record shape, ONE
 * rate limiter and ONE authorization gate rather than seven near-identical
 * copies of each.
 *
 * NOT IN SCOPE, BY CONSTRUCTION: there is no operation here that takes a
 * command, a script, a shell string, or a caller-supplied absolute path.
 * Every filesystem read is resolved by the WORKER from its own configured
 * work root (see apps/worker/src/diagnostics/confine-path.ts); the API/browser
 * contributes only a closed enum value and, at most, a bounded integer.
 */
export const READ_ONLY_DIAGNOSTIC_KINDS = [
  "GET_WORKER_LOG_TAIL",
  "GET_PREVIOUS_WORKER_LOG",
  "GET_DYO_PROCESS_TREE",
  "GET_DISK_SPACE",
  "GET_AE_MCP_HEALTH",
  "GET_ACTIVE_JOB_DETAILS",
  "GET_JOB_ARTIFACTS"
] as const;
export type ReadOnlyDiagnosticKind = (typeof READ_ONLY_DIAGNOSTIC_KINDS)[number];
export const readOnlyDiagnosticKindSchema = z.enum(READ_ONLY_DIAGNOSTIC_KINDS);

/** The full set of names the mandate specifies, read-only plus the one mutating operation. Exported for documentation/UI labelling only - never used as a dispatch allowlist (the two capability schemas below are). */
export const ALL_DIAGNOSTIC_OPERATION_NAMES = [...READ_ONLY_DIAGNOSTIC_KINDS, "RESTART_DYO_WORKER_SAFE"] as const;

/**
 * Hard ceiling on how much log text one request may return. A diagnostic
 * that can return an unbounded file is a denial-of-service against both the
 * worker's memory and the jobs table, and it is never what an operator
 * actually needs - a tail is.
 */
export const MAX_LOG_TAIL_LINES = 500;
export const DEFAULT_LOG_TAIL_LINES = 120;
/** Bytes. Applied AFTER the line limit, as a second independent ceiling, because a single log line can itself be enormous (a stack trace, a serialized payload). */
export const MAX_DIAGNOSTIC_RESPONSE_BYTES = 512 * 1024;

export const runDiagnosticRequestSchema = z
  .object({
    kind: readOnlyDiagnosticKindSchema,
    /** Only meaningful for the two log operations; ignored elsewhere. Bounded on both ends so a caller can neither request the whole file nor an empty response. */
    tailLines: z.number().int().min(1).max(MAX_LOG_TAIL_LINES).optional(),
    /**
     * Only meaningful for GET_JOB_ARTIFACTS: which job's on-disk artifacts to
     * describe. A UUID, never a path - the worker resolves it to a location
     * under its own work root itself.
     */
    jobId: z.string().uuid().optional()
  })
  .strict();
export type RunDiagnosticRequest = z.infer<typeof runDiagnosticRequestSchema>;

/** One line of evidence. `truncated` is never silently omitted: an operator must always be able to tell a short answer from a clipped one. */
export const diagnosticTextEvidenceSchema = z.object({
  path: z.string().nullable(),
  lines: z.array(z.string()),
  truncated: z.boolean(),
  /** Why the evidence is incomplete or absent, in plain words. Null when it is complete. */
  note: z.string().nullable()
});

export const diagnosticProcessSchema = z.object({
  processId: z.number().int(),
  parentProcessId: z.number().int().nullable(),
  name: z.string(),
  /** Already redacted and already classified by the worker - never a raw arbitrary command line. */
  commandLineSummary: z.string(),
  role: z.enum(["SCHEDULED_TASK", "POWERSHELL_SUPERVISOR", "NODE_SUPERVISOR", "WORKER", "AE_MCP", "AFTER_EFFECTS", "AERENDER", "OTHER"]),
  startedAt: z.string().nullable()
});

export const diagnosticDiskSchema = z.object({
  path: z.string(),
  totalBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative(),
  note: z.string().nullable()
});

export const runDiagnosticResponseSchema = z.object({
  kind: readOnlyDiagnosticKindSchema,
  capturedAt: z.string().datetime(),
  workerId: z.string().uuid(),
  /** False whenever the worker could not gather the evidence. A diagnostic that failed must say so - it must never return an empty-but-successful-looking result. */
  ok: z.boolean(),
  /** Present only for the kinds that produce text evidence. */
  text: diagnosticTextEvidenceSchema.optional(),
  processes: z.array(diagnosticProcessSchema).optional(),
  disks: z.array(diagnosticDiskSchema).optional(),
  /** Free-form but SCHEMA-VALIDATED-BY-THE-PRODUCER detail for GET_AE_MCP_HEALTH / GET_ACTIVE_JOB_DETAILS / GET_JOB_ARTIFACTS. Always redacted before it reaches here. */
  detail: z.record(z.unknown()).optional(),
  /** Always populated on failure, always null on success. */
  failureReason: z.string().nullable()
});
export type RunDiagnosticResponse = z.infer<typeof runDiagnosticResponseSchema>;

/**
 * The one MUTATING diagnostic. Deliberately its own capability so it can be
 * authorized, rate-limited and audited separately from evidence gathering.
 *
 * Safety contract, enforced in apps/worker/src/diagnostics/restart-worker-safe.ts:
 *  - the worker's persisted identity (.env, credential store, workerId) is
 *    never read, written, or re-registered by this path;
 *  - it REFUSES while an unsafe operation is in flight - any job that is
 *    mutating an AE project or rendering and has not reached a durable
 *    checkpoint - rather than interrupting it;
 *  - it restarts through the existing supervisor so exactly one supervisor
 *    and one worker survive, never a second tree.
 */
export const restartWorkerSafeRequestSchema = z
  .object({
    /**
     * A deliberate, explicit confirmation rather than a bare empty payload -
     * this is the one diagnostic that changes the machine's state, and it
     * should not be reachable by an accidental/replayed empty POST.
     */
    confirm: z.literal("RESTART_DYO_WORKER_SAFE"),
    /** Recorded in the audit log. Required: a restart with no stated reason is not auditable. */
    reason: z.string().min(3).max(500)
  })
  .strict();
export type RestartWorkerSafeRequest = z.infer<typeof restartWorkerSafeRequestSchema>;

export const RESTART_REFUSAL_REASONS = [
  "UNSAFE_JOB_IN_FLIGHT",
  "SUPERVISOR_NOT_FOUND",
  "DUPLICATE_TREE_DETECTED"
] as const;
export const restartRefusalReasonSchema = z.enum(RESTART_REFUSAL_REASONS);

export const restartWorkerSafeResponseSchema = z.object({
  workerId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  /** "restarting" means the restart was actually initiated. "refused" means nothing was changed at all. */
  outcome: z.enum(["restarting", "refused"]),
  refusalReason: restartRefusalReasonSchema.nullable(),
  detail: z.string(),
  /** Proof the identity was untouched: the worker echoes the id it is running as, read from its already-persisted credentials. */
  identityPreserved: z.boolean()
});
export type RestartWorkerSafeResponse = z.infer<typeof restartWorkerSafeResponseSchema>;
