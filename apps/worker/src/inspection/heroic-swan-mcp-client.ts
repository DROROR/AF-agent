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

export class HeroicSwanMcpClient {
  private readonly aeMcpPath: string;
  private readonly timeoutMs: number;
  private client: Client | null = null;

  constructor(config: HeroicSwanMcpClientConfig) {
    this.aeMcpPath = config.aeMcpPath;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
    const client = new Client({ name: "dyo-video-agent-worker", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport, { timeout: this.timeoutMs });
    this.client = client;
  }

  /** Closes the transport and terminates the spawned ae-mcp `serve` process. Safe to call even if connect() was never called or already failed. */
  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) {
      await client.close();
    }
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
