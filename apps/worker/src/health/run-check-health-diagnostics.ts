import { existsSync } from "node:fs";
import path from "node:path";
import type { CheckHealthResponse, McpHealthProcessResult } from "@dyo/schemas";
import type { ProcessLister } from "../infrastructure/process-lister.js";
import { runBoundedProcess } from "../infrastructure/run-bounded-process.js";
import { detectAeHealth, type AeHealthConfig } from "./ae-health.js";

const HEALTH_SUBCOMMAND = "health";
const DEFAULT_TIMEOUT_MS = 8_000;

export interface RunCheckHealthDiagnosticsConfig extends AeHealthConfig {
  /** ae-mcp's install directory (AE_MCP_PATH) - the CLI script is always exactly `<aeMcpPath>/dist/index.js`, never a separately-configurable path. */
  aeMcpPath: string | undefined;
  timeoutMs?: number;
}

const NOT_RUN_PROCESS_RESULT: McpHealthProcessResult = {
  aeMcpPathConfigured: false,
  scriptExists: null,
  exitCode: null,
  timedOut: false,
  stdout: "",
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false
};

/**
 * The one real CHECK_HEALTH implementation - runs exactly two already-
 * approved fixed diagnostics, never an arbitrary command:
 *   1. AE executable/path health (detectAeHealth - the same process-list
 *      check every heartbeat already uses).
 *   2. `node <AE_MCP_PATH>/dist/index.js health` - the same fixed,
 *      documented upstream command HeroicSwanMcpAdapter's heartbeat check
 *      runs (see its own doc comment for how that contract was
 *      confirmed), but here capturing bounded stdout/stderr and the
 *      timeout/exit distinction for real remote diagnosis - detail the
 *      heartbeat path deliberately never needed and never captured.
 *
 * Deliberately separate from HeroicSwanMcpAdapter/buildHealthSnapshot
 * (the heartbeat-critical path, used every heartbeat) - this is a
 * dedicated, independent read path so this addition can never regress
 * heartbeat behavior.
 *
 * Never returns a secret: no worker token, no registration secret, no
 * environment variables beyond the two already-public config paths, no
 * arbitrary filesystem listing - only this one fixed command's own
 * stdout/stderr, bounded in size.
 */
export async function runCheckHealthDiagnostics(
  config: RunCheckHealthDiagnosticsConfig,
  deps: { processLister: ProcessLister }
): Promise<CheckHealthResponse> {
  const ae = await detectAeHealth(config, deps.processLister);
  const aeMcpPathConfigured = Boolean(config.aeMcpPath);

  let mcpStatus: CheckHealthResponse["mcpStatus"] = "UNKNOWN";
  let mcpProcess: McpHealthProcessResult = { ...NOT_RUN_PROCESS_RESULT, aeMcpPathConfigured };

  if (config.aeMcpPath) {
    const scriptPath = path.join(config.aeMcpPath, "dist", "index.js");
    const scriptExists = existsSync(scriptPath);

    if (!scriptExists) {
      mcpProcess = { ...NOT_RUN_PROCESS_RESULT, aeMcpPathConfigured, scriptExists: false };
    } else {
      const result = await runBoundedProcess("node", [scriptPath, HEALTH_SUBCOMMAND], config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      mcpProcess = {
        aeMcpPathConfigured,
        scriptExists: true,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout: result.stdout,
        stderr: result.stderr,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated
      };
      // Same documented contract as HeroicSwanMcpAdapter.checkHealth():
      // 0 = ONLINE, 1 = OFFLINE (real evidence of "not running"), anything
      // else (2, null/timeout, unrecognized) = UNKNOWN, never fabricated.
      mcpStatus = result.exitCode === 0 ? "ONLINE" : result.exitCode === 1 ? "OFFLINE" : "UNKNOWN";
    }
  }

  return {
    aeStatus: ae.aeStatus,
    aeVersion: ae.aeVersion,
    mcpStatus,
    mcpProcess,
    checkedAt: new Date().toISOString()
  };
}
