import {
  DEFAULT_LOG_TAIL_LINES,
  MAX_DIAGNOSTIC_RESPONSE_BYTES,
  MAX_LOG_TAIL_LINES,
  type ReadOnlyDiagnosticKind,
  type RunDiagnosticRequest,
  type RunDiagnosticResponse
} from "@dyo/schemas";
import { redactLines, redactStructured } from "./redact.js";
import { withDeadline } from "../infrastructure/with-deadline.js";

/**
 * Hard ceiling on ONE diagnostic. A diagnostic that hangs would occupy this
 * worker's single job slot and, worse, would be indistinguishable from the
 * stalls it exists to investigate.
 */
export const DIAGNOSTIC_DEADLINE_MS = 20_000;

export interface DiagnosticProcessRecord {
  processId: number;
  parentProcessId: number | null;
  name: string;
  commandLine: string | null;
  startedAt: string | null;
}

export interface DiagnosticTextRead {
  path: string | null;
  lines: string[];
  truncated: boolean;
  note: string | null;
}

export interface DiagnosticDiskRead {
  path: string;
  totalBytes: number;
  freeBytes: number;
  note: string | null;
}

/**
 * Every capability a diagnostic needs, injected. Nothing in here accepts a
 * caller-supplied path or command: `readTextTail` takes a WORK-ROOT-RELATIVE
 * path chosen by this module from a fixed set, never from the request.
 */
export interface RunDiagnosticDeps {
  workerId: string;
  now: () => Date;
  /** Reads the last `maxLines` lines of a work-root-relative file. Must confine the path itself (see confine-path.ts). */
  readTextTail: (relativePath: string, maxLines: number) => Promise<DiagnosticTextRead>;
  listDyoProcesses: () => Promise<DiagnosticProcessRecord[]>;
  readDiskSpace: () => Promise<DiagnosticDiskRead[]>;
  probeAeMcpHealth: () => Promise<Record<string, unknown>>;
  describeActiveJob: () => Promise<Record<string, unknown>>;
  describeJobArtifacts: (jobId: string) => Promise<Record<string, unknown>>;
}

/** The FIXED work-root-relative log locations. A caller names a kind, never a path. */
export const WORKER_LOG_RELATIVE_PATH = "app/logs/worker.log";
export const PREVIOUS_WORKER_LOG_RELATIVE_PATH = "app/logs/worker.log.previous";

/**
 * Classifies a real Windows process into the role an operator actually cares
 * about, and reduces its command line to a SUMMARY - never the raw string.
 * A raw command line is the single most likely place for a token to appear
 * on this machine (the worker child is launched with --env-file, and other
 * tooling is not this codebase's to vouch for).
 */
export function classifyDyoProcess(record: DiagnosticProcessRecord): {
  role: string;
  commandLineSummary: string;
} {
  const command = (record.commandLine ?? "").toLowerCase();
  const name = record.name.toLowerCase();

  if (name.includes("afterfx")) {
    return { role: "AFTER_EFFECTS", commandLineSummary: "AfterFX.exe" };
  }
  if (name.includes("aerender")) {
    return { role: "AERENDER", commandLineSummary: "aerender.exe" };
  }
  if (command.includes("dist\\supervisor\\index.js") || command.includes("dist/supervisor/index.js")) {
    return { role: "NODE_SUPERVISOR", commandLineSummary: "node dist\\supervisor\\index.js" };
  }
  if (command.includes("--env-file=.env dist\\index.js") || command.includes("--env-file=.env dist/index.js")) {
    return { role: "WORKER", commandLineSummary: "node --env-file=.env dist\\index.js" };
  }
  if (command.includes("ae-mcp")) {
    return { role: "AE_MCP", commandLineSummary: "node ae-mcp dist\\index.js serve" };
  }
  if (name.includes("powershell") && command.includes("run-worker-supervisor")) {
    return { role: "POWERSHELL_SUPERVISOR", commandLineSummary: "powershell run-worker-supervisor.ps1" };
  }
  return { role: "OTHER", commandLineSummary: record.name };
}

function clampTailLines(requested: number | undefined): number {
  if (requested === undefined) {
    return DEFAULT_LOG_TAIL_LINES;
  }
  return Math.max(1, Math.min(MAX_LOG_TAIL_LINES, Math.trunc(requested)));
}

/**
 * Applies the byte ceiling AFTER redaction and AFTER the line limit, because
 * one log line can be enormous on its own. Drops from the FRONT: the newest
 * lines are the ones an incident needs.
 */
export function capResponseBytes(lines: readonly string[], maxBytes = MAX_DIAGNOSTIC_RESPONSE_BYTES): {
  lines: string[];
  truncated: boolean;
} {
  const kept: string[] = [];
  let total = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] as string;
    const size = Buffer.byteLength(line, "utf8") + 1;
    if (total + size > maxBytes) {
      return { lines: kept, truncated: true };
    }
    total += size;
    kept.unshift(line);
  }
  return { lines: kept, truncated: false };
}

async function readLog(
  deps: RunDiagnosticDeps,
  relativePath: string,
  tailLines: number | undefined
): Promise<Pick<RunDiagnosticResponse, "text" | "ok" | "failureReason">> {
  const read = await deps.readTextTail(relativePath, clampTailLines(tailLines));
  const redacted = redactLines(read.lines);
  const capped = capResponseBytes(redacted);
  return {
    ok: true,
    failureReason: null,
    text: {
      path: read.path,
      lines: capped.lines,
      truncated: read.truncated || capped.truncated,
      note: read.note
    }
  };
}

/**
 * Executes one allowlisted, read-only diagnostic.
 *
 * NEVER THROWS: a diagnostic that fails must come back as a structured
 * `ok: false` with a stated reason. An operator investigating an incident is
 * badly served by a second, nested incident, and a thrown error here would
 * surface only as a generic job failure - exactly the opaque outcome this
 * whole feature exists to eliminate.
 */
export async function runDiagnostic(
  deps: RunDiagnosticDeps,
  request: RunDiagnosticRequest
): Promise<RunDiagnosticResponse> {
  const base = {
    kind: request.kind,
    capturedAt: deps.now().toISOString(),
    workerId: deps.workerId
  } satisfies Pick<RunDiagnosticResponse, "kind" | "capturedAt" | "workerId">;

  try {
    return await withDeadline(`diagnostic ${request.kind}`, DIAGNOSTIC_DEADLINE_MS, async () => {
      switch (request.kind) {
        case "GET_WORKER_LOG_TAIL":
          return { ...base, ...(await readLog(deps, WORKER_LOG_RELATIVE_PATH, request.tailLines)) };

        case "GET_PREVIOUS_WORKER_LOG":
          return { ...base, ...(await readLog(deps, PREVIOUS_WORKER_LOG_RELATIVE_PATH, request.tailLines)) };

        case "GET_DYO_PROCESS_TREE": {
          const records = await deps.listDyoProcesses();
          return {
            ...base,
            ok: true,
            failureReason: null,
            processes: records.map((record) => {
              const { role, commandLineSummary } = classifyDyoProcess(record);
              return {
                processId: record.processId,
                parentProcessId: record.parentProcessId,
                name: record.name,
                commandLineSummary,
                role: role as never,
                startedAt: record.startedAt
              };
            })
          };
        }

        case "GET_DISK_SPACE":
          return { ...base, ok: true, failureReason: null, disks: await deps.readDiskSpace() };

        case "GET_AE_MCP_HEALTH":
          return {
            ...base,
            ok: true,
            failureReason: null,
            detail: redactStructured(await deps.probeAeMcpHealth()) as Record<string, unknown>
          };

        case "GET_ACTIVE_JOB_DETAILS":
          return {
            ...base,
            ok: true,
            failureReason: null,
            detail: redactStructured(await deps.describeActiveJob()) as Record<string, unknown>
          };

        case "GET_JOB_ARTIFACTS": {
          if (!request.jobId) {
            return { ...base, ok: false, failureReason: "GET_JOB_ARTIFACTS requires a jobId" };
          }
          return {
            ...base,
            ok: true,
            failureReason: null,
            detail: redactStructured(await deps.describeJobArtifacts(request.jobId)) as Record<string, unknown>
          };
        }

        default: {
          // Exhaustiveness: a new kind added to the schema without a handler
          // here fails to compile rather than silently returning nothing.
          const unreachable: never = request.kind;
          return { ...base, ok: false, failureReason: `Unhandled diagnostic kind: ${String(unreachable)}` };
        }
      }
    });
  } catch (error) {
    return {
      ...base,
      ok: false,
      failureReason: error instanceof Error ? error.message : "diagnostic failed for an unknown reason"
    };
  }
}

export type { ReadOnlyDiagnosticKind };
