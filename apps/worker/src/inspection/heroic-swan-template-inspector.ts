import { templateManifestSchema, type InspectTemplateRequest, type TemplateManifest } from "@dyo/schemas";
import { HeroicSwanMcpClient, type AllowedInspectionTool } from "./heroic-swan-mcp-client.js";
import type {
  InspectTemplateResult,
  ManifestInspectionResult,
  RawInspectionCapture,
  RawToolCallCapture,
  TemplateInspector
} from "./template-inspector.js";
import { computeInspectionSummary, buildTemplateManifest } from "./build-manifest.js";
import { buildProjectFacts } from "./build-project-facts.js";
import { hashSourceProject } from "./hash-source-project.js";
import {
  parseAeVersionFromHealth,
  parseCompositionDetail,
  parseCompositionList,
  type CompositionDetail,
  type CompositionSummary
} from "./parse-mcp-shapes.js";

/**
 * Real, production INSPECT_TEMPLATE implementation, wired against
 * HeroicSwanMcpClient - which itself only ever reaches the five allowlisted
 * read-only tools (ae_health, ae_list_instances, ae_get_project_info,
 * ae_list_compositions, ae_get_composition) via a TypeScript union type,
 * not a runtime check. There is no method on this class, or on
 * HeroicSwanMcpClient, that can call ae_run_jsx or any other upstream tool.
 *
 * Flow: call the four zero-argument discovery tools (captured for
 * diagnostics regardless of outcome), then attempt to build a real,
 * schema-validated TemplateManifest from their parsed, confirmed-shape
 * content plus one bounded ae_get_composition call per discovered
 * composition. Any failure along that path (a tool call, a parse, or
 * hashing the real source .aep - CLAUDE.md Safety Rule 8) falls back to
 * a RawInspectionCapture instead of guessing or crashing - see
 * docs/TEMPLATE-INSPECTOR.md.
 */
const DISCOVERY_TOOLS: readonly AllowedInspectionTool[] = [
  "ae_health",
  "ae_list_instances",
  "ae_get_project_info",
  "ae_list_compositions"
];

/**
 * Safety backstop against a pathological project causing hundreds of
 * sequential MCP round-trips - real projects seen so far (45
 * compositions) are far under this. Compositions beyond this count are
 * simply not detail-fetched; the manifest still includes them at
 * summary-level facts only, and this is recorded as an unknown item.
 */
const MAX_COMPOSITIONS_TO_INSPECT = 300;

/**
 * Caps how much of each discovery tool's raw content gets stored/reported
 * as diagnostics, so a single large project can never balloon the job
 * result or flood logs. A truncated capture is marked as such rather than
 * silently losing data with no indication.
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

  async inspect(request: InspectTemplateRequest): Promise<InspectTemplateResult> {
    if (!this.aeMcpPath) {
      return rawCaptureFor(
        DISCOVERY_TOOLS.map((tool) => ({
          tool,
          calledAt: new Date().toISOString(),
          ok: false,
          error: { code: "NOT_CONFIGURED", message: "AE_MCP_PATH is not configured" }
        })),
        "AE_MCP_PATH is not configured - no discovery tools could be called, so no manifest was attempted."
      );
    }

    const client = new HeroicSwanMcpClient({ aeMcpPath: this.aeMcpPath });

    try {
      await client.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await client.close();
      return rawCaptureFor(
        DISCOVERY_TOOLS.map((tool) => ({
          tool,
          calledAt: new Date().toISOString(),
          ok: false,
          error: { code: "TRANSPORT_ERROR" as const, message }
        })),
        `Could not connect to ae-mcp (${message}) - no manifest was attempted.`
      );
    }

    try {
      const discovery: RawToolCallCapture[] = [];
      for (const tool of DISCOVERY_TOOLS) {
        discovery.push(await captureOneTool(client, tool));
      }

      const listCompositionsCall = discovery.find((c) => c.tool === "ae_list_compositions");
      const parsedList = listCompositionsCall?.ok ? parseCompositionList(listCompositionsCall.content) : null;
      if (!listCompositionsCall?.ok || !parsedList || !parsedList.ok) {
        const reason = !listCompositionsCall?.ok
          ? `ae_list_compositions failed (${listCompositionsCall?.error?.message ?? "unknown error"})`
          : `ae_list_compositions' response did not match the confirmed shape (${parsedList && !parsedList.ok ? parsedList.reason : "unknown"})`;
        return rawCaptureFor(
          discovery,
          `${reason} - ae_get_composition was not attempted and no manifest was built; falling back to a raw capture.`
        );
      }

      const hashResult = await hashSourceProject(request.sourceProjectPath);
      if (!hashResult.ok) {
        return rawCaptureFor(
          discovery,
          `Could not hash the real source .aep at sourceProjectPath (${hashResult.reason}) - ` +
            "CLAUDE.md Safety Rule 8 requires a real verified hash before a manifest can be built, " +
            "so this falls back to a raw capture instead of fabricating sourceProject facts."
        );
      }

      const healthCall = discovery.find((c) => c.tool === "ae_health");
      const parsedHealth = healthCall?.ok ? parseAeVersionFromHealth(healthCall.content) : null;
      const aeVersion = parsedHealth?.ok ? parsedHealth.value : null;

      const discovered: CompositionSummary[] = parsedList.value.slice(0, MAX_COMPOSITIONS_TO_INSPECT);
      const truncatedCompositionCount = parsedList.value.length - discovered.length;

      const details: (CompositionDetail | null)[] = [];
      for (const summary of discovered) {
        const call = await captureOneTool(client, "ae_get_composition", {
          comp_index: summary.index,
          response_format: "detailed"
        });
        const parsedDetail = call.ok ? parseCompositionDetail(call.content) : null;
        details.push(parsedDetail && parsedDetail.ok ? parsedDetail.value : null);
      }

      const facts = buildProjectFacts({
        templateId: request.templateId,
        sourceProjectPath: hashResult.value.path,
        sourceProjectName: hashResult.value.name,
        projectSha256: hashResult.value.sha256,
        aeVersion,
        discovered,
        details
      });

      let manifest: TemplateManifest;
      try {
        manifest = templateManifestSchema.parse(buildTemplateManifest(facts));
      } catch (error) {
        return rawCaptureFor(
          discovery,
          "The built TemplateManifest failed its own schema validation " +
            `(${error instanceof Error ? error.message : String(error)}) - falling back to a raw capture rather ` +
            "than returning an invalid manifest."
        );
      }

      for (let i = 0; i < discovered.length; i++) {
        if (details[i] === null) {
          const summary = discovered[i];
          if (summary) {
            manifest.unknownItems.push({
              context: summary.name,
              reason:
                "ae_get_composition did not return usable layer data for this composition - only " +
                "composition-level facts (name/dimensions/duration) are confirmed"
            });
          }
        }
      }
      if (truncatedCompositionCount > 0) {
        manifest.unknownItems.push({
          context: "(project)",
          reason:
            `${truncatedCompositionCount} composition(s) beyond the first ${MAX_COMPOSITIONS_TO_INSPECT} ` +
            "were discovered but not detail-fetched (safety bound on sequential MCP calls)."
        });
      }

      const result: ManifestInspectionResult = {
        kind: "manifest",
        response: { manifest, summary: computeInspectionSummary(manifest) },
        diagnostics: discovery
      };
      return result;
    } finally {
      await client.close();
    }
  }
}

async function captureOneTool(
  client: HeroicSwanMcpClient,
  tool: AllowedInspectionTool,
  args?: Record<string, unknown>
): Promise<RawToolCallCapture> {
  const calledAt = new Date().toISOString();
  const result = await client.callTool(tool, args);
  if (result.ok) {
    return { tool, calledAt, ok: true, ...boundCapturedContent(result.content) };
  }
  return { tool, calledAt, ok: false, error: result.error };
}

function rawCaptureFor(toolCalls: RawToolCallCapture[], note: string): RawInspectionCapture {
  return { kind: "raw_capture", capturedAt: new Date().toISOString(), toolCalls, note };
}
