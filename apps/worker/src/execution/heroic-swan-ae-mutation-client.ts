import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { FixedJsxScript } from "./jsx-templates.js";

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
const DEFAULT_TIMEOUT_MS = 30_000;
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
  timeoutMs?: number;
}

export class HeroicSwanAeMutationClient {
  private readonly aeMcpPath: string;
  private readonly timeoutMs: number;
  private client: Client | null = null;

  constructor(config: HeroicSwanAeMutationClientConfig) {
    this.aeMcpPath = config.aeMcpPath;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
    await client.connect(transport, { timeout: this.timeoutMs });
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
        { timeout: this.timeoutMs }
      );
      if (result.isError) {
        return { ok: false, error: { code: "TOOL_ERROR", message: extractErrorText(result.content) } };
      }
      return { ok: true, content: result.content };
    } catch (error) {
      return { ok: false, error: { code: "TRANSPORT_ERROR", message: error instanceof Error ? error.message : String(error) } };
    }
  }
}
