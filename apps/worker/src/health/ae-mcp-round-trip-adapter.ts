import { existsSync } from "node:fs";
import path from "node:path";
import type { McpAdapter, McpHealthResult } from "./mcp-adapter.js";
import { parseBridgeConnectedFromHealth } from "../inspection/parse-mcp-shapes.js";

/**
 * Real 2026-09-12 incident, and why this replaces HeroicSwanMcpAdapter's
 * exit-code probe: FAHADNAKASH reported `mcpStatus: UNKNOWN`,
 * `mcpProbeDetail: "timeout"` continuously, while ae-mcp's own AE panel
 * showed the bridge genuinely LISTENING/CONNECTED with a fresh heartbeat.
 * The old probe ran `node <ae-mcp>/dist/index.js health` with a hard 8s
 * ceiling; upstream's `health` subcommand is not a cheap ping (it performs
 * an "ensure" step - checks AE is running, ensures/kicks the bridge, counts
 * live instances), so on a busy machine it can legitimately exceed 8s. Node
 * then killed it, which surfaced as UNKNOWN - a healthy bridge reported as
 * "cannot determine", every 15 seconds forever, blocking every dispatch
 * whose precondition is MCP ONLINE.
 *
 * Three separate faults in that design, all fixed here:
 *
 *   1. It measured the wrong thing. A CLI's exit code is not the path real
 *      jobs use. This performs the SAME real MCP round trip a job does -
 *      spawn the bridge transport, call the allowlisted read-only
 *      `ae_health` tool, parse its confirmed shape - so ONLINE means "the
 *      exact channel jobs depend on answered just now", never an inference.
 *   2. Its single attempt had a short, non-configurable ceiling and no
 *      retry, so one slow moment became a permanent UNKNOWN.
 *      This makes bounded, backed-off attempts (never unbounded - see
 *      maxAttempts) before ever reporting UNKNOWN.
 *   3. It re-spawned a fresh ae-mcp process on EVERY 15s heartbeat and
 *      SIGKILLed it at 8s. This caches a confirmed-ONLINE result for a
 *      short TTL, so a healthy machine does far less work, and only
 *      re-probes eagerly when the last answer was not ONLINE.
 *
 * Never reports a false ONLINE: ONLINE requires a real, parsed response
 * whose own `connected` field is true. A response that parses but reports
 * the bridge disconnected is OFFLINE (real evidence). Anything that could
 * not be established at all stays UNKNOWN, with a short fixed-vocabulary
 * detail naming the real mechanism.
 */
const HEALTH_TOOL = "ae_health" as const;

/** Deliberately far above the old 8s ceiling: upstream's own bridge "ensure" work is the thing being waited on, and a slow-but-healthy bridge must never read as UNKNOWN. */
const DEFAULT_CALL_TIMEOUT_MS = 20_000;
/** Bounded - never an unbounded retry loop (CLAUDE.md rule 9: pause safely rather than retry forever). */
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_BACKOFF_MS = 1_500;
/** A confirmed-ONLINE answer is reused for this long instead of re-spawning a bridge process on every heartbeat. Short enough that a real disconnect is still noticed promptly. */
const DEFAULT_ONLINE_CACHE_TTL_MS = 60_000;

/** The minimal shape this adapter needs from an MCP client - HeroicSwanMcpClient satisfies it; tests inject a fake rather than spawning a real ae-mcp process. */
export interface HealthProbeClient {
  connect(): Promise<void>;
  callTool(name: typeof HEALTH_TOOL, args?: Record<string, unknown>): Promise<{ ok: true; content: unknown } | { ok: false; error: { code: string; message: string } }>;
  close(): Promise<void>;
}

export interface AeMcpRoundTripAdapterConfig {
  aeMcpPath: string | undefined;
  callTimeoutMs?: number;
  maxAttempts?: number;
  retryBackoffMs?: number;
  onlineCacheTtlMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  createClient?: (aeMcpPath: string, timeoutMs: number) => HealthProbeClient;
}

interface CachedResult {
  at: number;
  result: McpHealthResult;
}

export class AeMcpRoundTripAdapter implements McpAdapter {
  private readonly aeMcpPath: string | undefined;
  private readonly callTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly onlineCacheTtlMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly createClient: ((aeMcpPath: string, timeoutMs: number) => HealthProbeClient) | undefined;
  private cached: CachedResult | null = null;
  /** Prevents two overlapping probes (a slow probe plus the next heartbeat) from ever spawning two bridge processes at once. */
  private inFlight: Promise<McpHealthResult> | null = null;

  constructor(config: AeMcpRoundTripAdapterConfig) {
    this.aeMcpPath = config.aeMcpPath;
    this.callTimeoutMs = config.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBackoffMs = config.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this.onlineCacheTtlMs = config.onlineCacheTtlMs ?? DEFAULT_ONLINE_CACHE_TTL_MS;
    this.now = config.now ?? (() => Date.now());
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.createClient = config.createClient;
  }

  async checkHealth(): Promise<McpHealthResult> {
    if (!this.aeMcpPath) {
      return { mcpStatus: "UNKNOWN", mcpConfiguredPath: null, mcpProbeDetail: "not-configured" };
    }
    const scriptPath = path.join(this.aeMcpPath, "dist", "index.js");
    // Kept from the previous adapter: a missing script is a configuration
    // problem, never evidence about the bridge - see its own doc comment.
    if (!existsSync(scriptPath)) {
      return { mcpStatus: "UNKNOWN", mcpConfiguredPath: scriptPath, mcpProbeDetail: "script-missing" };
    }

    const cached = this.cached;
    if (cached && cached.result.mcpStatus === "ONLINE" && this.now() - cached.at < this.onlineCacheTtlMs) {
      return { ...cached.result, mcpProbeDetail: `${cached.result.mcpProbeDetail}-cached` };
    }

    // Never run two probes concurrently - a probe slower than the heartbeat
    // interval would otherwise stack bridge processes.
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.probe(scriptPath);
    try {
      const result = await this.inFlight;
      this.cached = { at: this.now(), result };
      return result;
    } finally {
      this.inFlight = null;
    }
  }

  private async probe(scriptPath: string): Promise<McpHealthResult> {
    let lastDetail = "no-attempt";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const outcome = await this.attemptOnce(scriptPath);
      if (outcome.terminal) {
        return outcome.result;
      }
      lastDetail = outcome.result.mcpProbeDetail;
      if (attempt < this.maxAttempts) {
        await this.sleep(this.retryBackoffMs);
      }
    }
    return {
      mcpStatus: "UNKNOWN",
      mcpConfiguredPath: scriptPath,
      mcpProbeDetail: `${lastDetail}-after-${this.maxAttempts}-attempts`
    };
  }

  /** `terminal: true` means this answer is real evidence (ONLINE/OFFLINE) and must not be retried away. */
  private async attemptOnce(scriptPath: string): Promise<{ terminal: boolean; result: McpHealthResult }> {
    const client = this.createClient
      ? this.createClient(this.aeMcpPath as string, this.callTimeoutMs)
      : null;
    if (!client) {
      return {
        terminal: true,
        result: { mcpStatus: "UNKNOWN", mcpConfiguredPath: scriptPath, mcpProbeDetail: "no-client-factory" }
      };
    }

    try {
      await client.connect();
    } catch {
      await safeClose(client);
      return {
        terminal: false,
        result: { mcpStatus: "UNKNOWN", mcpConfiguredPath: scriptPath, mcpProbeDetail: "connect-failed" }
      };
    }

    try {
      const call = await client.callTool(HEALTH_TOOL);
      if (!call.ok) {
        return {
          terminal: false,
          result: { mcpStatus: "UNKNOWN", mcpConfiguredPath: scriptPath, mcpProbeDetail: `call-failed:${call.error.code}` }
        };
      }
      const parsed = parseBridgeConnectedFromHealth(call.content);
      if (!parsed.ok) {
        // The bridge answered, but not in the confirmed shape. That is a
        // real answer about a real channel, so it is not retried as if it
        // were a transport blip - but it is never reported as ONLINE.
        return {
          terminal: true,
          result: { mcpStatus: "UNKNOWN", mcpConfiguredPath: scriptPath, mcpProbeDetail: "unrecognized-health-shape" }
        };
      }
      if (parsed.value.connected) {
        return {
          terminal: true,
          result: { mcpStatus: "ONLINE", mcpConfiguredPath: scriptPath, mcpProbeDetail: "round-trip-ok" }
        };
      }
      return {
        terminal: true,
        result: { mcpStatus: "OFFLINE", mcpConfiguredPath: scriptPath, mcpProbeDetail: "bridge-not-connected" }
      };
    } catch {
      return {
        terminal: false,
        result: { mcpStatus: "UNKNOWN", mcpConfiguredPath: scriptPath, mcpProbeDetail: "call-threw" }
      };
    } finally {
      await safeClose(client);
    }
  }
}

async function safeClose(client: HealthProbeClient): Promise<void> {
  try {
    await client.close();
  } catch {
    // Never let cleanup failure change the health verdict.
  }
}
