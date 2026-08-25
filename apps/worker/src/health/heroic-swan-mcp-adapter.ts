import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { McpAdapter, McpHealthResult } from "./mcp-adapter.js";

/**
 * Real, upstream-confirmed integration with HeroicSwan/after-effects-mcp
 * (confirmed 2026-08-24 directly from the upstream repository's
 * package.json `scripts` and `src/index.ts`, not assumed):
 *   package.json: "health": "node dist/index.js health"
 * `bin.ae-mcp` also points at `./dist/index.js`, confirming this is the
 * real, documented CLI entry point - not a guess.
 *
 * Deliberately does NOT parse the CLI's stdout. Upstream's `health`
 * subcommand prints several separate, human-labeled console.log lines
 * mixed with JSON fragments ("Data dir: ...", "AE running: ...",
 * "Ensure: {...}", "Live instances: N", trailing JSON blobs) - not one
 * coherent, stable, documented JSON object. Depending on that text would
 * repeat the exact mistake already made twice this session (guessing at
 * an undocumented internal shape). The one thing upstream DOES document
 * as a stable contract is the process exit code:
 *   0 = bridge connected, health invoked successfully -> ONLINE
 *   1 = bridge not connected -> OFFLINE (real evidence of "not running")
 *   2 = health invocation itself failed -> UNKNOWN (ambiguous)
 * Anything else (spawn failure, ae-mcp not installed, timeout, an
 * unrecognized exit code) is also UNKNOWN - never fabricated.
 */
const HEALTH_SUBCOMMAND = "health";
const DEFAULT_TIMEOUT_MS = 8_000;

export interface HeroicSwanMcpAdapterConfig {
  /** ae-mcp's install directory (AE_MCP_PATH) - the CLI script is always exactly `<aeMcpPath>/dist/index.js`, never a separately-configurable path. */
  aeMcpPath: string | undefined;
  timeoutMs?: number;
}

export class HeroicSwanMcpAdapter implements McpAdapter {
  private readonly aeMcpPath: string | undefined;
  private readonly timeoutMs: number;

  constructor(config: HeroicSwanMcpAdapterConfig) {
    this.aeMcpPath = config.aeMcpPath;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async checkHealth(): Promise<McpHealthResult> {
    if (!this.aeMcpPath) {
      return { mcpStatus: "UNKNOWN", mcpConfiguredPath: null };
    }

    const scriptPath = path.join(this.aeMcpPath, "dist", "index.js");

    // Checked explicitly, before ever spawning `node`. Without this, a
    // missing script produces Node's OWN "cannot find module" failure,
    // which exits 1 - indistinguishable, by exit code alone, from
    // ae-mcp's own documented "exit 1 = bridge not connected" (real
    // spawn-based testing caught exactly this collision). A missing
    // script is a config problem (AE_MCP_PATH wrong, or ae-mcp not
    // actually installed there), not evidence the bridge is down.
    if (!existsSync(scriptPath)) {
      return { mcpStatus: "UNKNOWN", mcpConfiguredPath: scriptPath };
    }

    const exitCode = await runHealthCheck(scriptPath, this.timeoutMs);

    if (exitCode === 0) {
      return { mcpStatus: "ONLINE", mcpConfiguredPath: scriptPath };
    }
    if (exitCode === 1) {
      return { mcpStatus: "OFFLINE", mcpConfiguredPath: scriptPath };
    }
    // exitCode === 2, null (spawn error/timeout), or any unrecognized code.
    return { mcpStatus: "UNKNOWN", mcpConfiguredPath: scriptPath };
  }
}

/**
 * Runs the exact allowlisted command `node <scriptPath> health` - never a
 * shell string, never a user-influenced argument, nothing beyond this one
 * fixed script path and this one fixed subcommand literal. Returns the
 * real exit code, or null if the process could not be run at all/timed
 * out/exited via a signal - the caller treats null the same as an
 * unrecognized code (UNKNOWN).
 */
function runHealthCheck(scriptPath: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("node", [scriptPath, HEALTH_SUBCOMMAND], { timeout: timeoutMs }, (error) => {
      if (!error) {
        resolve(0);
        return;
      }
      // Node's child_process callback reports a non-zero exit via `error`,
      // with the real exit code on `error.code` when the process actually
      // ran and exited (as opposed to failing to spawn at all, or being
      // killed for exceeding `timeout`, where `code` is a signal name/
      // undefined instead of a number).
      const exitCode = typeof error.code === "number" ? error.code : null;
      resolve(exitCode);
    });
  });
}
