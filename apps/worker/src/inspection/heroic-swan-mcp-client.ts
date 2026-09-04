import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { FixedJsxScript } from "../execution/jsx-templates.js";

/**
 * Real, upstream-confirmed transport for HeroicSwan/after-effects-mcp's MCP
 * server (confirmed 2026-08-24 directly from the upstream repository, not
 * assumed): package.json's `start` script is `node dist/index.js serve`,
 * and `src/index.ts` starts a stdio-transport MCP server there via
 * `serveStdio()`. This client spawns exactly that one fixed command via the
 * official `@modelcontextprotocol/sdk` - the same SDK upstream itself
 * depends on - and speaks the real MCP protocol (initialize handshake,
 * then `tools/call`), never a hand-rolled parser of undocumented output.
 *
 * `dist/mcp/tools/index.ts` upstream registers many tools (Blender bridge,
 * transcription, editorial planning, workflow audits, etc.) well beyond AE
 * inspection - ae_run_jsx in particular can mutate a live AE project. This
 * client's public surface is a closed allowlist of exactly the seven
 * read-only inspection tools named below; there is no method to call any
 * other tool name, by construction (TypeScript union, not just a runtime
 * check).
 *
 * ae_get_layer and ae_capture_frame were added 2026-08-26 (Phase 7B) after
 * reading the real upstream host-script implementations in full
 * (host-scripts/ae-mcp-methods.jsx's `layer.get`/`view.captureFrame`/
 * `view.captureFrames` case blocks): ae_get_layer only ever reads
 * layer.get -> layerSummary(), never writes any property; ae_capture_frame/
 * ae_capture_frames call comp.saveFrameToPng() (a render-a-still-to-a-new-
 * PNG-file operation, never app.project.save()) and always restore the
 * composition's prior current-time before returning, including on the
 * catch path. Neither tool can mutate persisted project state.
 */
const SERVE_SUBCOMMAND = "serve";
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Purely an outer bound on how long this client's own terminate() logs a
 * "still waiting" outcome before giving up - the real kill sequence lives
 * entirely inside the MCP SDK's own StdioClientTransport.close() (stdin
 * end + 2s wait, then SIGTERM + 2s wait, then SIGKILL - see
 * @modelcontextprotocol/sdk/dist/*\/client/stdio.js), which is already
 * scoped to exactly the one child process THIS transport spawned. This is
 * only a safety backstop in case that resolves unexpectedly slowly.
 */
const TERMINATE_OUTER_BUDGET_MS = 8_000;

export interface McpChildTerminationLogger {
  info: (meta: Record<string, unknown>, message: string) => void;
  warn: (meta: Record<string, unknown>, message: string) => void;
}

export type McpChildTerminationOutcome =
  | { outcome: "no_process"; pid: null; reason: string; durationMs: number }
  | { outcome: "terminated"; pid: number; reason: string; durationMs: number }
  | { outcome: "unconfirmed"; pid: number; reason: string; durationMs: number };

/** A resource that owns exactly one ae-mcp child process and can prove it stopped - see runtime/job-execution-registry.ts, the one real consumer. */
export interface McpChildOwner {
  terminate(reason: string): Promise<McpChildTerminationOutcome>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cross-platform (including Windows - libuv implements signal 0 there as a
 * liveness check via OpenProcess/GetExitCodeProcess, not a real POSIX
 * signal) liveness probe. Never throws.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const ALLOWED_INSPECTION_TOOLS = [
  "ae_health",
  "ae_list_instances",
  "ae_get_project_info",
  "ae_list_compositions",
  "ae_get_composition",
  "ae_get_layer",
  "ae_capture_frame"
] as const;

export type AllowedInspectionTool = (typeof ALLOWED_INSPECTION_TOOLS)[number];

export interface ToolCallSuccess {
  ok: true;
  /**
   * Raw MCP `content` array (text/image/audio/resource blocks) - deliberately
   * NOT parsed into a rigid schema here. Upstream's exact field-level
   * response shape for these tools has not been confirmed against a real
   * sample the way the ae-mcp instance.json schema was; over-fitting a
   * schema to an unconfirmed shape would repeat the exact mistake already
   * made twice this session. Callers that need typed fields should
   * validate defensively at the point of use, once a real sample exists.
   */
  content: unknown;
}

export interface ToolCallFailure {
  ok: false;
  error: { code: "NOT_CONNECTED" | "TOOL_ERROR" | "TRANSPORT_ERROR"; message: string };
}

export type ToolCallResult = ToolCallSuccess | ToolCallFailure;

export interface HeroicSwanMcpClientConfig {
  /** ae-mcp's install directory (AE_MCP_PATH) - the CLI script is always exactly `<aeMcpPath>/dist/index.js`, never a separately-configurable path. */
  aeMcpPath: string;
  timeoutMs?: number;
  /** Optional - only used to log PID/reason/outcome around terminate(). Never required for correct behavior. */
  logger?: McpChildTerminationLogger;
}

/** Extracts a human-readable message from an MCP tool-error content array, without assuming a specific shape beyond the documented `{type: "text", text}` block. */
function extractErrorText(content: unknown): string {
  if (Array.isArray(content)) {
    const textBlock = content.find(
      (block): block is { type: "text"; text: string } =>
        Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "text"
    );
    if (textBlock) {
      return textBlock.text;
    }
  }
  return "Tool reported an error (no text detail available)";
}

export class HeroicSwanMcpClient implements McpChildOwner {
  private readonly aeMcpPath: string;
  private readonly timeoutMs: number;
  private readonly logger: McpChildTerminationLogger | undefined;
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private terminating: Promise<McpChildTerminationOutcome> | null = null;

  constructor(config: HeroicSwanMcpClientConfig) {
    this.aeMcpPath = config.aeMcpPath;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = config.logger;
  }

  /** The PID of the ae-mcp child process this client owns, or null before connect() (or after termination). Only ever refers to a process THIS instance itself spawned. */
  get pid(): number | null {
    return this.transport?.pid ?? null;
  }

  /** Spawns the one fixed allowlisted command (`node <aeMcpPath>/dist/index.js serve`) and performs the real MCP initialize handshake. Throws on failure - callers decide how to report that. */
  async connect(): Promise<void> {
    const scriptPath = path.join(this.aeMcpPath, "dist", "index.js");
    const transport = new StdioClientTransport({
      command: "node",
      args: [scriptPath, SERVE_SUBCOMMAND],
      // "pipe" rather than the SDK's "inherit" default - ae-mcp's raw
      // stderr text is not ours to control and should not bypass this
      // worker's own structured (redacted) logging by interleaving
      // directly into it. Drained and discarded for now; a future pass
      // can surface it through the worker's own logger if genuinely useful.
      stderr: "pipe"
    });
    // Attaching a "data" listener switches a paused Readable to flowing
    // mode - the standard way to drain-and-discard a stream typed only as
    // the base `Stream` (which has no .resume()).
    transport.stderr?.on("data", () => {});
    // Retained BEFORE the initialize handshake below (2026-09-04 P0 fix):
    // this client already owns (and can terminate()) the exact process it
    // just spawned even if that handshake itself never resolves - the
    // hang does not have to be inside a later callTool() for this to be
    // able to prove/force it stopped. See job-execution-registry.ts, the
    // real consumer of this ownership.
    this.transport = transport;
    const client = new Client({ name: "dyo-video-agent-worker", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport, { timeout: this.timeoutMs });
    this.client = client;
  }

  /** Closes the transport and terminates the spawned ae-mcp `serve` process. Safe to call even if connect() was never called or already failed, and safe to call more than once (idempotent - see terminate()). */
  async close(): Promise<void> {
    await this.terminate("close() called");
  }

  /**
   * Idempotent, never throws: ensures the ae-mcp child process this client
   * owns (and ONLY that process - never any other node.exe/ae-mcp
   * instance, by construction, since this only ever touches the transport
   * THIS instance itself spawned) is terminated, with proof.
   *
   * Real production gap this closes (2026-09-04, job c19a2fb9 stuck
   * RUNNING for 20+ minutes): nothing previously retained ownership of - or
   * could prove the fate of - the ae-mcp subprocess a hung job's
   * connection had spawned, so killing/restarting only the Worker process
   * risked orphaning it. This delegates the actual kill sequence to the
   * MCP SDK's own StdioClientTransport.close() (stdin end + bounded wait,
   * then SIGTERM + bounded wait, then SIGKILL, all scoped to its own
   * `_process` field - see @modelcontextprotocol/sdk's client/stdio.js),
   * then independently verifies via isProcessAlive(pid) rather than just
   * trusting that call resolved cleanly - "unconfirmed" is reported
   * honestly rather than assumed.
   *
   * Concurrent/repeated calls share one outcome (never re-enters the real
   * kill sequence twice) - callers (e.g. a watchdog aborting a job AND
   * that job's own normal `finally { client.close() }` racing each other)
   * never need to coordinate who "owns" calling this.
   */
  async terminate(reason: string): Promise<McpChildTerminationOutcome> {
    if (this.terminating) {
      return this.terminating;
    }
    this.terminating = this.doTerminate(reason);
    return this.terminating;
  }

  private async doTerminate(reason: string): Promise<McpChildTerminationOutcome> {
    const pid = this.pid;
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;

    if (!client && !transport) {
      return { outcome: "no_process", pid: null, reason, durationMs: 0 };
    }

    const startedAt = Date.now();
    this.logger?.info({ pid, reason }, "terminating owned ae-mcp child process");

    try {
      await Promise.race([
        client ? client.close() : (transport as StdioClientTransport).close(),
        sleep(TERMINATE_OUTER_BUDGET_MS)
      ]);
    } catch (error) {
      this.logger?.warn(
        { pid, reason, error: error instanceof Error ? error.message : String(error) },
        "close() threw while terminating owned ae-mcp child process"
      );
    }

    const durationMs = Date.now() - startedAt;
    if (pid === null) {
      return { outcome: "no_process", pid: null, reason, durationMs };
    }
    const alive = isProcessAlive(pid);
    const outcome: McpChildTerminationOutcome = alive
      ? { outcome: "unconfirmed", pid, reason, durationMs }
      : { outcome: "terminated", pid, reason, durationMs };
    if (alive) {
      this.logger?.warn(outcome, "owned ae-mcp child process could not be confirmed stopped within the outer budget");
    } else {
      this.logger?.info(outcome, "owned ae-mcp child process confirmed stopped");
    }
    return outcome;
  }

  /**
   * Calls exactly one of the seven allowlisted read-only inspection tools.
   * Never throws - every failure (not connected, the tool itself reporting
   * an error, or a transport/protocol failure) is reported as a typed
   * ToolCallFailure, matching the "never fabricate, always report failure
   * honestly" contract already used by TemplateInspector/AfterEffectsRenderer.
   */
  async callTool(name: AllowedInspectionTool, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    if (!this.client) {
      return {
        ok: false,
        error: { code: "NOT_CONNECTED", message: "connect() must succeed before calling a tool" }
      };
    }
    try {
      const result = await this.client.callTool({ name, arguments: args }, undefined, { timeout: this.timeoutMs });
      if (result.isError) {
        return { ok: false, error: { code: "TOOL_ERROR", message: extractErrorText(result.content) } };
      }
      return { ok: true, content: result.content };
    } catch (error) {
      return {
        ok: false,
        error: { code: "TRANSPORT_ERROR", message: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  /**
   * The ONE exception to this client's "seven read-only tools" allowlist
   * above: `ae_run_jsx` is itself a genuinely unrestricted "unsafe"
   * channel at the ae-mcp wire level (see jsx-templates.ts's own module
   * doc comment - its `FixedJsxScript` brand, not this client, is the
   * actual safety boundary). This method can only ever be called with a
   * `FixedJsxScript` - a nominally-branded string only jsx-templates.ts
   * can construct - so this client still can never send arbitrary/ad-hoc
   * JSX, only the one script body TypeScript resolved this call with.
   * Used ONLY for INSPECT_TEMPLATE's own read-only composition-nesting
   * facts (see heroic-swan-template-inspector.ts and
   * buildInspectCompositionPrecompsScript) - never for any mutation, and
   * reuses this SAME connection rather than opening a second one.
   *
   * `timeoutMsOverride` (2026-09-03, real production incident): lets ONE
   * specific call use a different timeout than this client's own default
   * (`this.timeoutMs`), without changing that default for every other
   * call on the same connection - see OPEN_PROJECT_TIMEOUT_MS in
   * heroic-swan-template-inspector.ts, the one real caller of this. The
   * MCP SDK's own `callTool` already accepts a per-call `{ timeout }`
   * option; this simply exposes it for this one method rather than
   * introducing a second client instance/connection.
   */
  async runFixedInspectionScript(script: FixedJsxScript, timeoutMsOverride?: number): Promise<ToolCallResult> {
    if (!this.client) {
      return {
        ok: false,
        error: { code: "NOT_CONNECTED", message: "connect() must succeed before calling a tool" }
      };
    }
    try {
      const result = await this.client.callTool(
        { name: "ae_run_jsx", arguments: { code: script, mode: "unsafe" } },
        undefined,
        { timeout: timeoutMsOverride ?? this.timeoutMs }
      );
      if (result.isError) {
        return { ok: false, error: { code: "TOOL_ERROR", message: extractErrorText(result.content) } };
      }
      return { ok: true, content: result.content };
    } catch (error) {
      return {
        ok: false,
        error: { code: "TRANSPORT_ERROR", message: error instanceof Error ? error.message : String(error) }
      };
    }
  }
}
