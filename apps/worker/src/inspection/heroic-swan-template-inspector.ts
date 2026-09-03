import { z } from "zod";
import type pino from "pino";
import { hasAepExtension, templateManifestSchema, type InspectTemplateRequest, type TemplateManifest } from "@dyo/schemas";
import { HeroicSwanMcpClient, type AllowedInspectionTool, type ToolCallResult } from "./heroic-swan-mcp-client.js";
import type {
  InspectTemplateResult,
  ManifestInspectionResult,
  ProjectOpenEvidence,
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
  parseCurrentProjectFromHealth,
  type CompositionDetail,
  type CompositionSummary
} from "./parse-mcp-shapes.js";
import { buildInspectCompositionPrecompsScript, buildOpenProjectScript } from "../execution/jsx-templates.js";
import { unwrapJsxResult } from "../execution/unwrap-jsx-result.js";
import { windowsPathsEqual } from "./canonical-windows-path.js";
import { callWithTransientRetry, type TransientRetryOptions } from "./retry-transient-mcp-call.js";

/**
 * Real, production INSPECT_TEMPLATE implementation, wired against
 * HeroicSwanMcpClient - which reaches the seven allowlisted read-only
 * tools (ae_health, ae_list_instances, ae_get_project_info,
 * ae_list_compositions, ae_get_composition, ae_get_layer, ae_capture_frame)
 * via a TypeScript union type, not a runtime check, PLUS exactly one
 * additional, fixed, versioned, read-only JSX script
 * (buildInspectCompositionPrecompsScript, via
 * HeroicSwanMcpClient.runFixedInspectionScript - see that method's own
 * doc comment for why this is still not "arbitrary JSX from inspection"),
 * PLUS - as of the P0 fix below - one more fixed script
 * (buildOpenProjectScript) used ONLY to ensure the correct target project
 * is open before any of the above is trusted.
 *
 * Flow (P0 fix, 2026-09-03, real production incident): call ae_health
 * first and check whether AE already has EXACTLY the requested
 * sourceProjectPath open (see ensureTargetProjectOpen below). A real
 * client attempt proved this cannot be assumed - AE had an unrelated
 * "Untitled" project open (projectPath: null) - so INSPECT_TEMPLATE no
 * longer trusts whatever happens to already be open: it opens the exact
 * requested file itself when necessary, then re-verifies AE's own
 * self-reported path matches before proceeding at all. If that
 * open/verify step cannot succeed, this fails closed into a
 * RawInspectionCapture immediately - no discovery tool beyond ae_health
 * is even attempted, and no manifest is ever built from evidence that
 * might belong to the wrong project.
 *
 * Once the correct project is confirmed open, the remaining three
 * zero-argument discovery tools are called (captured for diagnostics
 * regardless of outcome, each wrapped in a bounded transient-timeout
 * retry - P1 fix, same real incident: ae_get_project_info and
 * ae_list_compositions both proved capable of a genuine MCP transport
 * timeout mid-inspection), then this attempts to build a real,
 * schema-validated TemplateManifest from their parsed, confirmed-shape
 * content plus one bounded ae_get_composition call AND one bounded
 * composition-precomps script call per discovered composition (also
 * retried on a transient timeout) - the latter is what makes
 * isNestedOnlyReferenced/parentCompositionIds real, evidence-based facts
 * instead of a permanent false/[] stub - client-facing UX redesign,
 * "LIVE UX ACCEPTANCE FAILED" follow-up). Any failure along the
 * manifest-building path (a tool call, a parse, or hashing the real
 * source .aep - CLAUDE.md Safety Rule 8) falls back to a
 * RawInspectionCapture instead of guessing or crashing - see
 * docs/TEMPLATE-INSPECTOR.md. A precomps-script failure for one
 * composition never falls back to a raw capture by itself - it only
 * means that ONE composition's own precomp facts stay unknown, exactly
 * like an ae_get_composition detail failure already does.
 */
const REMAINING_DISCOVERY_TOOLS: readonly AllowedInspectionTool[] = ["ae_list_instances", "ae_get_project_info", "ae_list_compositions"];

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

const ALL_DISCOVERY_TOOLS: readonly AllowedInspectionTool[] = ["ae_health", ...REMAINING_DISCOVERY_TOOLS];

export interface HeroicSwanTemplateInspectorConfig {
  /** ae-mcp's install directory (AE_MCP_PATH). If undefined, inspect() returns a capture whose entries are all typed failures - never throws for this expected case. */
  aeMcpPath: string | undefined;
  /** Structured logger for the P1 transient-retry log lines (operation/attempt/reason) - see retry-transient-mcp-call.ts. Optional so existing/test call sites that don't pass one keep working with no logging, never a crash. */
  logger?: pino.Logger;
  /** Test-only override for the P1 retry policy/attempt count - production always uses retry-transient-mcp-call.ts's own real defaults (2s/4s/8s bounded backoff) when this is omitted. */
  retryOptions?: TransientRetryOptions;
  /** Test-only override for the MCP client's own per-call timeout (heroic-swan-mcp-client.ts's DEFAULT_TIMEOUT_MS otherwise applies) - lets tests simulate a real transient timeout in milliseconds rather than the real 15-second production default. */
  mcpTimeoutMs?: number;
}

export class HeroicSwanTemplateInspector implements TemplateInspector {
  private readonly aeMcpPath: string | undefined;
  private readonly logger: pino.Logger | undefined;
  private readonly retryOptions: TransientRetryOptions | undefined;
  private readonly mcpTimeoutMs: number | undefined;

  constructor(config: HeroicSwanTemplateInspectorConfig) {
    this.aeMcpPath = config.aeMcpPath;
    this.logger = config.logger;
    this.retryOptions = config.retryOptions;
    this.mcpTimeoutMs = config.mcpTimeoutMs;
  }

  async inspect(request: InspectTemplateRequest): Promise<InspectTemplateResult> {
    if (!this.aeMcpPath) {
      return rawCaptureFor(
        ALL_DISCOVERY_TOOLS.map((tool) => ({
          tool,
          calledAt: new Date().toISOString(),
          ok: false,
          error: { code: "NOT_CONFIGURED", message: "AE_MCP_PATH is not configured" }
        })),
        "AE_MCP_PATH is not configured - no discovery tools could be called, so no manifest was attempted."
      );
    }

    const client = new HeroicSwanMcpClient({ aeMcpPath: this.aeMcpPath, ...(this.mcpTimeoutMs !== undefined ? { timeoutMs: this.mcpTimeoutMs } : {}) });

    try {
      await client.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await client.close();
      return rawCaptureFor(
        ALL_DISCOVERY_TOOLS.map((tool) => ({
          tool,
          calledAt: new Date().toISOString(),
          ok: false,
          error: { code: "TRANSPORT_ERROR" as const, message }
        })),
        `Could not connect to ae-mcp (${message}) - no manifest was attempted.`
      );
    }

    try {
      // ---- P0 fix: ensure the REQUESTED sourceProjectPath is actually
      // open in AE before trusting anything else. A real client attempt
      // proved AE can have an unrelated project open ("Untitled",
      // projectPath: null) - see ensureTargetProjectOpen's own doc
      // comment. Fails closed immediately (no further discovery tool is
      // even attempted) if this cannot be confirmed - never queries or
      // builds a manifest from evidence that might belong to the wrong
      // project. ---
      const healthCapture = await captureOneToolWithRetry(client, "ae_health", this.logger, this.retryOptions);
      const openEvidence = await ensureTargetProjectOpen(client, request.sourceProjectPath, healthCapture, this.logger, this.retryOptions);
      if (!openEvidence.matched) {
        return rawCaptureFor(
          [healthCapture],
          `Could not confirm the requested target project is open in After Effects (${openEvidence.note ?? "unknown reason"}) - ` +
            "no other discovery tool was attempted and no manifest was built; falling back to a raw capture. " +
            "No client action is required - re-dispatching this inspection is safe once the underlying issue is resolved.",
          openEvidence
        );
      }

      const discovery: RawToolCallCapture[] = [healthCapture];
      for (const tool of REMAINING_DISCOVERY_TOOLS) {
        discovery.push(await captureOneToolWithRetry(client, tool, this.logger, this.retryOptions));
      }

      const listCompositionsCall = discovery.find((c) => c.tool === "ae_list_compositions");
      const parsedList = listCompositionsCall?.ok ? parseCompositionList(listCompositionsCall.content) : null;
      if (!listCompositionsCall?.ok || !parsedList || !parsedList.ok) {
        const reason = !listCompositionsCall?.ok
          ? `ae_list_compositions failed (${listCompositionsCall?.error?.message ?? "unknown error"})`
          : `ae_list_compositions' response did not match the confirmed shape (${parsedList && !parsedList.ok ? parsedList.reason : "unknown"})`;
        return rawCaptureFor(
          discovery,
          `${reason} - ae_get_composition was not attempted and no manifest was built; falling back to a raw capture.`,
          openEvidence
        );
      }

      // The API's inspectTemplateRequestSchema already rejects a non-.aep
      // sourceProjectPath before a job is ever created, so a request
      // reaching here should always already end in .aep - this re-checks
      // it anyway (defense in depth across the API/worker boundary, the
      // same convention validateJobPayload's own re-validation already
      // follows) rather than trusting that boundary alone. Deliberately
      // NOT inside hashSourceProject itself: that function is generic and
      // also reused by asset-cache.ts to hash non-.aep MAP_FOOTAGE assets.
      if (!hasAepExtension(request.sourceProjectPath)) {
        return rawCaptureFor(
          discovery,
          `sourceProjectPath (${request.sourceProjectPath}) does not end in .aep - ` +
            "no manifest was attempted.",
          openEvidence
        );
      }

      const hashResult = await hashSourceProject(request.sourceProjectPath);
      if (!hashResult.ok) {
        return rawCaptureFor(
          discovery,
          `Could not hash the real source .aep at sourceProjectPath (${hashResult.reason}) - ` +
            "CLAUDE.md Safety Rule 8 requires a real verified hash before a manifest can be built, " +
            "so this falls back to a raw capture instead of fabricating sourceProject facts.",
          openEvidence
        );
      }

      const healthCall = discovery.find((c) => c.tool === "ae_health");
      const parsedHealth = healthCall?.ok ? parseAeVersionFromHealth(healthCall.content) : null;
      const aeVersion = parsedHealth?.ok ? parsedHealth.value : null;

      const discovered: CompositionSummary[] = parsedList.value.slice(0, MAX_COMPOSITIONS_TO_INSPECT);
      const truncatedCompositionCount = parsedList.value.length - discovered.length;

      const details: (CompositionDetail | null)[] = [];
      const precompFacts: ({ layerIndex: number; sourceCompositionId: string }[] | null)[] = [];
      for (const summary of discovered) {
        const call = await captureOneToolWithRetry(
          client,
          "ae_get_composition",
          this.logger,
          this.retryOptions,
          { comp_index: summary.index, response_format: "detailed" }
        );
        const parsedDetail = call.ok ? parseCompositionDetail(call.content) : null;
        details.push(parsedDetail && parsedDetail.ok ? parsedDetail.value : null);
        precompFacts.push(await fetchPrecompFacts(client, summary, this.logger, this.retryOptions));
      }

      const facts = buildProjectFacts({
        templateId: request.templateId,
        sourceProjectPath: hashResult.value.path,
        sourceProjectName: hashResult.value.name,
        projectSha256: hashResult.value.sha256,
        aeVersion,
        discovered,
        details,
        precompFacts
      });

      let manifest: TemplateManifest;
      try {
        manifest = templateManifestSchema.parse(buildTemplateManifest(facts));
      } catch (error) {
        return rawCaptureFor(
          discovery,
          "The built TemplateManifest failed its own schema validation " +
            `(${error instanceof Error ? error.message : String(error)}) - falling back to a raw capture rather ` +
            "than returning an invalid manifest.",
          openEvidence
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
        diagnostics: discovery,
        projectOpenEvidence: openEvidence
      };
      return result;
    } finally {
      await client.close();
    }
  }
}

const precompScriptResultSchema = z.union([
  z.object({ ok: z.literal(true), precompLayers: z.array(z.object({ layerIndex: z.number(), layerName: z.string(), sourceCompositionId: z.string() })) }).strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

/**
 * Best-effort per-composition precomp-reference facts (client-facing UX
 * redesign, "LIVE UX ACCEPTANCE FAILED" follow-up) - returns `null` (never
 * throws) on ANY failure (transport, tool-reported error, envelope parse,
 * schema mismatch, or the script's own typed failureReason), exactly like
 * a failed ae_get_composition detail call already does. A `null` here
 * only means THIS ONE composition's own children stay unknown to
 * build-project-facts.ts's nesting computation - it never blocks the
 * manifest or any other composition's own facts. P1 fix: the underlying
 * runFixedInspectionScript call is now retried on a transient MCP
 * timeout, same as every other real inspection call in this file - a
 * genuinely deterministic failure (a TOOL_ERROR, an envelope/schema
 * mismatch, or the script's own typed failureReason) is still never
 * retried, only ever reported as null exactly as before.
 */
async function fetchPrecompFacts(
  client: HeroicSwanMcpClient,
  summary: CompositionSummary,
  logger: pino.Logger | undefined,
  retryOptions: TransientRetryOptions | undefined
): Promise<{ layerIndex: number; sourceCompositionId: string }[] | null> {
  const script = buildInspectCompositionPrecompsScript(summary.index, summary.name);
  const result = await callWithTransientRetry(`precomp_facts:${summary.name}`, logger, () => client.runFixedInspectionScript(script), retryOptions);
  if (!result.ok) {
    return null;
  }
  const unwrapped = unwrapJsxResult(result.content);
  if (!unwrapped.ok) {
    return null;
  }
  const parsed = precompScriptResultSchema.safeParse(unwrapped.value);
  if (!parsed.success || !parsed.data.ok) {
    return null;
  }
  return parsed.data.precompLayers.map((layer) => ({ layerIndex: layer.layerIndex, sourceCompositionId: layer.sourceCompositionId }));
}

/** Captures one allowlisted read-only tool call, transparently retrying a transient MCP timeout (P1 fix) - see retry-transient-mcp-call.ts. A deterministic TOOL_ERROR/NOT_CONNECTED is still reported immediately, never retried. */
async function captureOneToolWithRetry(
  client: HeroicSwanMcpClient,
  tool: AllowedInspectionTool,
  logger: pino.Logger | undefined,
  retryOptions: TransientRetryOptions | undefined,
  args?: Record<string, unknown>
): Promise<RawToolCallCapture> {
  const calledAt = new Date().toISOString();
  const result = await callWithTransientRetry(tool, logger, () => client.callTool(tool, args), retryOptions);
  if (result.ok) {
    return { tool, calledAt, ok: true, ...boundCapturedContent(result.content) };
  }
  return { tool, calledAt, ok: false, error: result.error };
}

const openProjectScriptResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      resultingValue: z.object({ openedPath: z.string().nullable(), openedName: z.string().nullable() })
    })
    .strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

/**
 * P0 fix (2026-09-03, real production incident): proves - never assumes -
 * that AE has the REQUESTED sourceProjectPath open before any discovery
 * tool beyond ae_health is called. A real client attempt showed
 * INSPECT_TEMPLATE silently querying whatever project AE already had open
 * (an unrelated "Untitled" project, projectPath: null) - this closes that
 * gap.
 *
 * Two paths:
 *   1. Reuse: ae_health's own already-captured response (the cheap,
 *      always-called-anyway first discovery call) reports a project
 *      genuinely open at exactly the requested path - no open call is
 *      made at all. An unparseable/absent health.projectPath is NEVER
 *      treated as a match - only a real, positively-confirmed path
 *      match skips the open step.
 *   2. Open: otherwise, runs buildOpenProjectScript (a fixed, versioned,
 *      allowlisted script - never arbitrary JSX) via the same transient-
 *      retry wrapper every other real inspection call now uses (P1 fix -
 *      a stuck "save changes?" modal on the previously-open project, or a
 *      genuine MCP timeout, surfaces as a TRANSPORT_ERROR here exactly
 *      like any other transient MCP failure). The script's own
 *      self-reported opened path is then re-verified (never trusted
 *      blindly) against the requested path - a mismatch, an open
 *      failure, or a response that fails to parse all report
 *      `matched: false` with a clear, distinct reason, never silently
 *      treated as success.
 */
async function ensureTargetProjectOpen(
  client: HeroicSwanMcpClient,
  sourceProjectPath: string,
  healthCapture: RawToolCallCapture,
  logger: pino.Logger | undefined,
  retryOptions: TransientRetryOptions | undefined
): Promise<ProjectOpenEvidence> {
  const parsedHealth = healthCapture.ok ? parseCurrentProjectFromHealth(healthCapture.content) : null;
  if (parsedHealth?.ok && parsedHealth.value.projectOpen && windowsPathsEqual(parsedHealth.value.projectPath, sourceProjectPath)) {
    return {
      requestedPath: sourceProjectPath,
      actualOpenedPath: parsedHealth.value.projectPath,
      reused: true,
      matched: true
    };
  }

  const script = buildOpenProjectScript(sourceProjectPath);
  const openResult: ToolCallResult = await callWithTransientRetry(
    "ensure_target_project_open",
    logger,
    () => client.runFixedInspectionScript(script),
    retryOptions
  );
  if (!openResult.ok) {
    return {
      requestedPath: sourceProjectPath,
      actualOpenedPath: null,
      reused: false,
      matched: false,
      note: `the attempt to open the target project failed (${openResult.error.message})`
    };
  }

  const unwrapped = unwrapJsxResult(openResult.content);
  if (!unwrapped.ok) {
    return {
      requestedPath: sourceProjectPath,
      actualOpenedPath: null,
      reused: false,
      matched: false,
      note: `the open-project script's response could not be parsed (${unwrapped.reason})`
    };
  }
  const parsed = openProjectScriptResultSchema.safeParse(unwrapped.value);
  if (!parsed.success) {
    return {
      requestedPath: sourceProjectPath,
      actualOpenedPath: null,
      reused: false,
      matched: false,
      note: `the open-project script's response did not match the expected shape (${parsed.error.message})`
    };
  }
  if (!parsed.data.ok) {
    return {
      requestedPath: sourceProjectPath,
      actualOpenedPath: null,
      reused: false,
      matched: false,
      note: `the open-project script itself reported a failure (${parsed.data.failureReason})`
    };
  }

  const actualOpenedPath = parsed.data.resultingValue.openedPath;
  const matched = windowsPathsEqual(actualOpenedPath, sourceProjectPath);
  return {
    requestedPath: sourceProjectPath,
    actualOpenedPath,
    reused: false,
    matched,
    ...(matched
      ? {}
      : {
          note: "the project AE reports having open after the open attempt does not exactly match the requested sourceProjectPath - refusing to inspect the wrong project"
        })
  };
}

function rawCaptureFor(toolCalls: RawToolCallCapture[], note: string, projectOpenEvidence?: ProjectOpenEvidence): RawInspectionCapture {
  return { kind: "raw_capture", capturedAt: new Date().toISOString(), toolCalls, note, ...(projectOpenEvidence ? { projectOpenEvidence } : {}) };
}
