import type { InspectTemplateRequest } from "@dyo/schemas";
import { ALLOWED_INSPECTION_TOOLS, HeroicSwanMcpClient, type AllowedInspectionTool } from "./heroic-swan-mcp-client.js";
import type { RawInspectionCapture, RawToolCallCapture, TemplateInspector } from "./template-inspector.js";

/**
 * Real, production INSPECT_TEMPLATE implementation, wired against
 * HeroicSwanMcpClient - which itself only ever reaches the five allowlisted
 * read-only tools (ae_health, ae_list_instances, ae_get_project_info,
 * ae_list_compositions, ae_get_composition) via a TypeScript union type,
 * not a runtime check. There is no method on this class, or on
 * HeroicSwanMcpClient, that can call ae_run_jsx or any other upstream tool.
 *
 * First-pass behavior (see docs/TEMPLATE-INSPECTOR.md and
 * template-inspector.ts's RawInspectionCapture doc comment): captures the
 * REAL raw response from each of four zero-argument read-only tools,
 * rather than guessing at a TemplateManifest field mapping before any real
 * response shape has ever been observed. `ae_get_composition` requires a
 * real composition identifier (confirmed from `ae_list_compositions`'
 * response) as an argument - extracting that would mean guessing that
 * response's real field names, which is exactly what this capture pass
 * exists to avoid. It remains allowlisted and reachable through
 * HeroicSwanMcpClient, but this first pass does not call it; a follow-up
 * pass can once the real ae_list_compositions shape is known from this
 * capture's own output.
 */
const CAPTURED_TOOLS: readonly AllowedInspectionTool[] = [
  "ae_health",
  "ae_list_instances",
  "ae_get_project_info",
  "ae_list_compositions"
];

/**
 * Caps how much of each tool's raw content gets stored/reported, so a
 * single large project (many compositions/layers) can never balloon the
 * job result or flood logs. A truncated capture is marked as such rather
 * than silently losing data with no indication.
 */
const MAX_CAPTURED_CONTENT_CHARS = 20_000;

function boundCapturedContent(content: unknown): Pick<RawToolCallCapture, "content" | "truncated" | "originalContentLength"> {
  let serialized: string;
  try {
    serialized = JSON.stringify(content) ?? "null";
  } catch {
    // Content isn't JSON-serializable (e.g. contains a circular reference
    // or a BigInt) - store that fact honestly rather than throwing or
    // silently dropping the capture for this tool. originalContentLength
    // is genuinely unknown here (never set to undefined explicitly -
    // exactOptionalPropertyTypes treats that differently from omitting it).
    return { content: "[unserializable content]", truncated: true };
  }
  if (serialized.length <= MAX_CAPTURED_CONTENT_CHARS) {
    return { content };
  }
  return {
    content: serialized.slice(0, MAX_CAPTURED_CONTENT_CHARS),
    truncated: true,
    originalContentLength: serialized.length
  };
}

export interface HeroicSwanTemplateInspectorConfig {
  /** ae-mcp's install directory (AE_MCP_PATH). If undefined, inspect() returns a capture whose entries are all typed failures - never throws for this expected case. */
  aeMcpPath: string | undefined;
}

export class HeroicSwanTemplateInspector implements TemplateInspector {
  private readonly aeMcpPath: string | undefined;

  constructor(config: HeroicSwanTemplateInspectorConfig) {
    this.aeMcpPath = config.aeMcpPath;
  }

  async inspect(_request: InspectTemplateRequest): Promise<RawInspectionCapture> {
    if (!this.aeMcpPath) {
      return {
        kind: "raw_capture",
        capturedAt: new Date().toISOString(),
        toolCalls: CAPTURED_TOOLS.map((tool) => ({
          tool,
          calledAt: new Date().toISOString(),
          ok: false,
          error: { code: "NOT_CONFIGURED", message: "AE_MCP_PATH is not configured" }
        })),
        note: buildNote([])
      };
    }

    const client = new HeroicSwanMcpClient({ aeMcpPath: this.aeMcpPath });
    const toolCalls: RawToolCallCapture[] = [];

    try {
      await client.connect();
    } catch (error) {
      // connect() itself failed - every planned tool call is equally
      // unreachable, for the same reason. Reported per-tool (not as one
      // generic failure) so the capture always names one of the five real
      // allowlisted tools, consistent with every other entry.
      const message = error instanceof Error ? error.message : String(error);
      await client.close();
      return {
        kind: "raw_capture",
        capturedAt: new Date().toISOString(),
        toolCalls: CAPTURED_TOOLS.map((tool) => ({
          tool,
          calledAt: new Date().toISOString(),
          ok: false,
          error: { code: "TRANSPORT_ERROR" as const, message }
        })),
        note: buildNote([])
      };
    }

    try {
      for (const tool of CAPTURED_TOOLS) {
        toolCalls.push(await captureOneTool(client, tool));
      }
    } finally {
      await client.close();
    }

    return {
      kind: "raw_capture",
      capturedAt: new Date().toISOString(),
      toolCalls,
      note: buildNote(toolCalls)
    };
  }
}

async function captureOneTool(client: HeroicSwanMcpClient, tool: AllowedInspectionTool): Promise<RawToolCallCapture> {
  const calledAt = new Date().toISOString();
  const result = await client.callTool(tool);
  if (result.ok) {
    return { tool, calledAt, ok: true, ...boundCapturedContent(result.content) };
  }
  return { tool, calledAt, ok: false, error: result.error };
}

function buildNote(toolCalls: RawToolCallCapture[]): string {
  const attempted = toolCalls.map((c) => c.tool);
  const notCalled = ALLOWED_INSPECTION_TOOLS.filter((tool) => !attempted.includes(tool));
  return (
    `First-pass raw capture - real response shapes are not yet confirmed, so no ` +
    `TemplateManifest mapping was attempted. Allowlisted but not called this pass: ` +
    `${notCalled.join(", ") || "none"} (ae_get_composition needs a real composition ` +
    `identifier from ae_list_compositions' own response, which this capture exists ` +
    `to discover safely - never guessed).`
  );
}
