import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { FixedJsxScript } from "./jsx-templates.js";
import { describeMcpFailure } from "./classify-mcp-failure.js";

/**
 * The ONE and ONLY write path from this worker into a live AE project.
 * Deliberately kept as its own small, separate class rather than added to
 * HeroicSwanMcpClient (apps/worker/src/inspection/heroic-swan-mcp-client.ts) -
 * that class's whole documented safety invariant is "100% read-only,
 * enforced by a closed TypeScript union of tool names"; extending it with a
 * write capability would blur that invariant for anyone auditing it later.
 * This file is the single, clearly-labeled place a reviewer needs to check
 * for AE mutation.
 *
 * The `runFixedOperation` method only accepts a `FixedJsxScript` - a
 * nominally-branded type that can only be produced by jsx-templates.ts's
 * own builders (see that file's doc comment). There is no public API on
 * this class that accepts a plain string; calling it with anything else is
 * a TypeScript compile error, not just a runtime check.
 *
 * VERIFIED (2026-08-27) directly from the real upstream source (never
 * assumed, and not from our own prior code): `tools/index.ts`'s real
 * `ae_run_jsx` registration takes `{code: string, args?:
 * Record<string,unknown>, mode?: "restricted"|"unsafe", description?:
 * string}` - NOT `{script}` (a wrong assumption this file previously
 * made, now fixed). `mode` MUST be `"unsafe"`: upstream's own comment
 * reads "restricted mode not yet allowlisting scripts", so any other
 * value is always rejected - this tool provides no safety of its own;
 * `FixedJsxScript`'s brand is the entire guarantee. `code` is executed
 * host-side via `new Function("args", code)` and the function's return
 * value is wrapped as `{ result: <that value> }` before this class's
 * caller ever sees it - see ae-edit-bridge.ts for how that extra envelope
 * is unwrapped, and jsx-templates.ts's own doc comment for why the JSX
 * text itself must be a bare function body (never a self-invoking
 * `(function(){...})()` expression).
 */
const SERVE_SUBCOMMAND = "serve";

/**
 * Bounds for one mutation connection and one mutation call.
 *
 * REAL 2026-09-14 FAILURES (session 1257ac95): right after a MAP_FOOTAGE
 * import of a large screenshot, After Effects stayed busy longer than the old
 * flat 30 s bound - job e80c36c4 could not even connect, and job a4a0ac5e's
 * next SET_TEXT timed out - yet AE answered normally seconds later both times.
 * A mutation that times out is never retried (its outcome is unknown); the
 * job fails honestly and the next fresh run rebuilds the working copy from the
 * source. So the bound only needs to outlast AE's real post-import busy
 * period, while still surfacing a genuinely hung AE within a couple of
 * minutes.
 */
export const DEFAULT_MUTATION_CONNECT_TIMEOUT_MS = 60_000;
export const DEFAULT_MUTATION_CALL_TIMEOUT_MS = 120_000;
const MUTATION_TOOL_NAME = "ae_run_jsx";
/** Fixed, non-sensitive audit string - upstream's own `description` field exists "for audit"; this never varies per call, so it can never leak per-request data into ae-mcp's own logs. */
const FIXED_OPERATION_DESCRIPTION = "DYO EXECUTE_FRAME fixed operation";

export interface MutationCallSuccess {
  ok: true;
  content: unknown;
}

export interface MutationCallFailure {
  ok: false;
  error: { code: "NOT_CONNECTED" | "TOOL_ERROR" | "TRANSPORT_ERROR"; message: string };
}

export type MutationCallResult = MutationCallSuccess | MutationCallFailure;

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

export interface HeroicSwanAeMutationClientConfig {
  aeMcpPath: string;
  /** Overrides BOTH the connect and the call bound (tests use a short one). */
  timeoutMs?: number;
}

export class HeroicSwanAeMutationClient {
  private readonly aeMcpPath: string;
  readonly connectTimeoutMs: number;
  readonly callTimeoutMs: number;
  private client: Client | null = null;

  constructor(config: HeroicSwanAeMutationClientConfig) {
    this.aeMcpPath = config.aeMcpPath;
    this.connectTimeoutMs = config.timeoutMs ?? DEFAULT_MUTATION_CONNECT_TIMEOUT_MS;
    this.callTimeoutMs = config.timeoutMs ?? DEFAULT_MUTATION_CALL_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    const scriptPath = path.join(this.aeMcpPath, "dist", "index.js");
    const transport = new StdioClientTransport({
      command: "node",
      args: [scriptPath, SERVE_SUBCOMMAND],
      stderr: "pipe"
    });
    transport.stderr?.on("data", () => {});
    const client = new Client({ name: "dyo-video-agent-worker", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport, { timeout: this.connectTimeoutMs });
    this.client = client;
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) {
      await client.close();
    }
  }

  /** Runs exactly one fixed, allowlisted, already-built JSX script - never a caller-supplied raw string (see the type of `script`). */
  async runFixedOperation(script: FixedJsxScript): Promise<MutationCallResult> {
    if (!this.client) {
      return { ok: false, error: { code: "NOT_CONNECTED", message: "connect() must succeed before running an operation" } };
    }
    try {
      const result = await this.client.callTool(
        {
          name: MUTATION_TOOL_NAME,
          arguments: {
            code: script,
            args: {},
            mode: "unsafe",
            description: FIXED_OPERATION_DESCRIPTION
          }
        },
        undefined,
        { timeout: this.callTimeoutMs }
      );
      if (result.isError) {
        return { ok: false, error: { code: "TOOL_ERROR", message: extractErrorText(result.content) } };
      }
      return { ok: true, content: result.content };
    } catch (error) {
      // describeMcpFailure classifies a genuine request timeout as
      // AE_UNRESPONSIVE/BRIDGE_TIMEOUT (the truthful, checkable equivalent
      // of a suspected stuck AE modal - see that function's own doc
      // comment) rather than an undifferentiated transport error.
      return { ok: false, error: { code: "TRANSPORT_ERROR", message: describeMcpFailure(error) } };
    }
  }
}
