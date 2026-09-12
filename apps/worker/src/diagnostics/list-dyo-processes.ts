import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DiagnosticProcessRecord } from "./run-diagnostic.js";

const execFileAsync = promisify(execFile);

/**
 * Enumerates the processes this project cares about, on Windows, via CIM.
 *
 * WHY NOT `tasklist`: tasklist cannot report a parent PID or a command line
 * together, and both are exactly what every process-tree incident in this
 * project has turned on - "is this the supervisor or the worker", "is this
 * ae-mcp or the worker" (the 2026-09-11 over-broad-kill incident), "is this
 * PID actually the process I measured, or a reused number" (2026-09-12).
 *
 * The command is a FIXED string with no interpolation of any kind: there is
 * no caller input on this path, so there is nothing to inject.
 */
const CIM_QUERY = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|powershell|pwsh|AfterFX|aerender)' } | " +
    "Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate | ConvertTo-Json -Compress -Depth 3"
];

/** Bounded so a pathological process table can never produce an unbounded response. */
export const MAX_PROCESS_RECORDS = 100;
export const PROCESS_QUERY_TIMEOUT_MS = 10_000;

interface RawCimProcess {
  ProcessId?: number;
  ParentProcessId?: number;
  Name?: string;
  CommandLine?: string | null;
  CreationDate?: string | null;
}

/** Exported for testing against real captured PowerShell output without a Windows machine. */
export function parseCimProcessJson(raw: string): DiagnosticProcessRecord[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  // ConvertTo-Json emits a bare object, not an array, when exactly one
  // process matches - a real and easily-missed PowerShell behaviour.
  const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

  const records: DiagnosticProcessRecord[] = [];
  for (const entry of list.slice(0, MAX_PROCESS_RECORDS)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const raw = entry as RawCimProcess;
    if (typeof raw.ProcessId !== "number" || typeof raw.Name !== "string") {
      continue;
    }
    records.push({
      processId: raw.ProcessId,
      parentProcessId: typeof raw.ParentProcessId === "number" ? raw.ParentProcessId : null,
      name: raw.Name,
      commandLine: typeof raw.CommandLine === "string" ? raw.CommandLine : null,
      startedAt: normalizeCimDate(raw.CreationDate ?? null)
    });
  }
  return records;
}

/**
 * CIM dates arrive either as a JSON-serialized .NET date (`/Date(…)/`) or as
 * a CIM_DATETIME string. Anything unrecognized becomes null rather than a
 * guessed timestamp - a wrong start time is worse than a missing one when
 * the question being asked is "is this the same process I saw before?".
 */
export function normalizeCimDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const dotNet = /\/Date\((\d+)/.exec(value);
  if (dotNet?.[1]) {
    return new Date(Number(dotNet[1])).toISOString();
  }
  const cim = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(value);
  if (cim) {
    const [, y, mo, d, h, mi, sec] = cim;
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec}Z`).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * `platform` is injected (rather than read from process.platform inline) so
 * the real command and the real parsing are testable off Windows.
 *
 * On a non-Windows platform this THROWS rather than returning an empty list.
 * An empty list would render as "no DYO processes are running" - a false
 * negative, and exactly the class of confident-but-wrong answer this whole
 * diagnostics feature exists to eliminate. runDiagnostic turns the throw into
 * a structured ok:false carrying this reason.
 */
export async function listDyoProcessesViaCim(
  runner: (args: string[]) => Promise<string> = defaultRunner,
  platform: NodeJS.Platform = process.platform
): Promise<DiagnosticProcessRecord[]> {
  if (platform !== "win32") {
    throw new Error(`process-tree enumeration is implemented for Windows only (this worker reports platform "${platform}")`);
  }
  return parseCimProcessJson(await runner(CIM_QUERY));
}

async function defaultRunner(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("powershell.exe", args, {
    timeout: PROCESS_QUERY_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  return stdout;
}
