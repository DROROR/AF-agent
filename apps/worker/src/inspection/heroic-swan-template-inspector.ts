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

/**
 * P0 reliability fix (2026-09-03, real production incident #3): the
 * ordinary 15s MCP call timeout (heroic-swan-mcp-client.ts's own
 * DEFAULT_TIMEOUT_MS) is deliberately kept short for every normal
 * read-only discovery call - a real client-machine trace proved a
 * genuinely healthy call completes in well under a second, so 15s is
 * already generous headroom for a transient blip on THOSE calls.
 * app.open() is different: it is a real, sometimes-slow AE operation
 * (project parsing, footage relinking, etc.), not a cheap read - a real
 * client trace showed it consistently exceeding 15s on every one of 3
 * consecutive attempts, and AE was STILL confirmed on "Untitled" ~48
 * minutes later (measured live via a fresh CHECK_HEALTH dispatch),
 * proving the failure is not "the response was merely slow to arrive" in
 * that specific case - but a bounded, more generous timeout for JUST
 * this one operation is still the correct, evidence-grounded fix for the
 * general case (a real project genuinely can take longer than 15s to
 * open), separate from whatever caused that specific incident. Chosen
 * from the requested 60-90s range - 75s gives real headroom without
 * approaching the updater's own unrelated 360s MCP-health-window
 * decision (DYO-Worker-Final-Update.ps1's own $AeMcpHealthWindowSeconds,
 * which governs a completely different question: whether a just-
 * restarted WORKER PROCESS is healthy, never an individual inspection
 * call).
 */
export const OPEN_PROJECT_TIMEOUT_MS = 75_000;

/**
 * If the single app.open() attempt above times out, MCP/stdio has no
 * cancellation guarantee - the ae-mcp bridge may still be processing (or
 * queued behind) that original request. Re-issuing app.open() in that
 * state risks a duplicate/overlapping open call. Instead, this is the
 * TOTAL additional bounded time spent polling read-only `ae_health`
 * (already the cheap, always-safe reuse-path check) for the requested
 * path to converge, at OPEN_PROJECT_POLL_INTERVAL_MS intervals, before
 * giving up and failing closed. Total worst case for the whole open
 * attempt is therefore OPEN_PROJECT_TIMEOUT_MS + this budget (~135s) -
 * still a small, bounded fraction of the updater's own unrelated 360s
 * window.
 */
export const OPEN_PROJECT_POLL_BUDGET_MS = 60_000;

/** How often to re-check `ae_health` while polling after a timed-out open attempt - frequent enough to notice a real open finishing promptly, never so frequent it floods the bridge with requests. */
export const OPEN_PROJECT_POLL_INTERVAL_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Test-only override for OPEN_PROJECT_TIMEOUT_MS/OPEN_PROJECT_POLL_BUDGET_MS/OPEN_PROJECT_POLL_INTERVAL_MS - production always uses the real constants above when this is omitted. */
export interface OpenProjectOptions {
  timeoutMs?: number;
  pollBudgetMs?: number;
  pollIntervalMs?: number;
}

export interface HeroicSwanTemplateInspectorConfig {
  /** ae-mcp's install directory (AE_MCP_PATH). If undefined, inspect() returns a capture whose entries are all typed failures - never throws for this expected case. */
  aeMcpPath: string | undefined;
  /** Structured logger for the P1 transient-retry log lines (operation/attempt/reason) - see retry-transient-mcp-call.ts. Optional so existing/test call sites that don't pass one keep working with no logging, never a crash. */
  logger?: pino.Logger;
  /** Test-only override for the P1 retry policy/attempt count - production always uses retry-transient-mcp-call.ts's own real defaults (2s/4s/8s bounded backoff) when this is omitted. */
  retryOptions?: TransientRetryOptions;
  /** Test-only override for the MCP client's own per-call timeout (heroic-swan-mcp-client.ts's DEFAULT_TIMEOUT_MS otherwise applies) - lets tests simulate a real transient timeout in milliseconds rather than the real 15-second production default. */
  mcpTimeoutMs?: number;
  /** Test-only override for the OPEN_PROJECT-specific timeout/poll budget/poll interval above - production always uses the real constants when this is omitted. */
  openProjectOptions?: OpenProjectOptions;
}

export class HeroicSwanTemplateInspector implements TemplateInspector {
  private readonly aeMcpPath: string | undefined;
  private readonly logger: pino.Logger | undefined;
  private readonly retryOptions: TransientRetryOptions | undefined;
  private readonly mcpTimeoutMs: number | undefined;
  private readonly openProjectOptions: OpenProjectOptions | undefined;

  constructor(config: HeroicSwanTemplateInspectorConfig) {
    this.aeMcpPath = config.aeMcpPath;
    this.logger = config.logger;
    this.retryOptions = config.retryOptions;
    this.mcpTimeoutMs = config.mcpTimeoutMs;
    this.openProjectOptions = config.openProjectOptions;
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
      const openEvidence = await ensureTargetProjectOpen(
        client,
        request.sourceProjectPath,
        healthCapture,
        this.logger,
        this.retryOptions,
        this.openProjectOptions
      );
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
 * Bounded, read-only poll for the requested project to appear after a
 * timed-out (never re-issued) app.open() attempt - see
 * ensureTargetProjectOpen's own doc comment and OPEN_PROJECT_POLL_BUDGET_MS.
 * Checks immediately (the real open may have already finished server-side
 * by the time our client gave up locally - MCP/stdio has no cancellation),
 * then re-checks at pollIntervalMs, until either a definitive answer
 * arrives or deadlineAt passes. Each individual poll's own ae_health call
 * still gets the ordinary P1 transient-retry treatment (it is a normal,
 * cheap read - only the NOT_CONNECTED case ends polling early, since no
 * further poll could ever succeed once the client itself is gone).
 *
 * Three distinct outcomes, never conflated:
 *   - matched: true - health now reports the exact requested path open.
 *   - matched: false with a "does not exactly match" note - health
 *     reports a DIFFERENT, definite (non-null) project now open. This
 *     ends polling immediately rather than waiting out the full budget -
 *     once AE has definitively settled on the wrong project, further
 *     waiting cannot change that.
 *   - matched: false with a "timed out ... never appeared" note - the
 *     full poll budget elapsed with the project still not open (null/
 *     Untitled, or transiently unreadable) at the requested path.
 */
async function pollForProjectOpen(
  client: HeroicSwanMcpClient,
  sourceProjectPath: string,
  logger: pino.Logger | undefined,
  retryOptions: TransientRetryOptions | undefined,
  pollIntervalMs: number,
  deadlineAt: number
): Promise<{ matched: boolean; actualOpenedPath: string | null; note?: string }> {
  for (;;) {
    const healthResult = await callWithTransientRetry(
      "ensure_target_project_open:poll_health",
      logger,
      () => client.callTool("ae_health"),
      retryOptions
    );
    if (!healthResult.ok) {
      if (healthResult.error.code === "NOT_CONNECTED") {
        return { matched: false, actualOpenedPath: null, note: `health polling failed (${healthResult.error.message})` };
      }
      // A TOOL_ERROR/exhausted TRANSPORT_ERROR from one poll is inconclusive,
      // not fatal - the connection itself is still alive, so keep polling.
    } else {
      const parsedHealth = parseCurrentProjectFromHealth(healthResult.content);
      if (parsedHealth.ok && parsedHealth.value.projectOpen && parsedHealth.value.projectPath !== null) {
        const matched = windowsPathsEqual(parsedHealth.value.projectPath, sourceProjectPath);
        return {
          matched,
          actualOpenedPath: parsedHealth.value.projectPath,
          ...(matched
            ? {}
            : {
                note:
                  "the project AE reports having open after the timed-out open attempt does not exactly match the " +
                  "requested sourceProjectPath - refusing to inspect the wrong project"
              })
        };
      }
    }

    if (Date.now() >= deadlineAt) {
      return {
        matched: false,
        actualOpenedPath: null,
        note:
          "the open request timed out and the target project never appeared within the bounded polling budget " +
          "(no app.open() retry was attempted - MCP/stdio has no cancellation guarantee, so re-issuing it could " +
          "have risked a duplicate/overlapping open)"
      };
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadlineAt - Date.now())));
  }
}

/**
 * P0 fix (2026-09-03, real production incident): proves - never assumes -
 * that AE has the REQUESTED sourceProjectPath open before any discovery
 * tool beyond ae_health is called. A real client attempt showed
 * INSPECT_TEMPLATE silently querying whatever project AE already had open
 * (an unrelated "Untitled" project, projectPath: null) - this closes that
 * gap.
 *
 * Reliability fix (2026-09-03, real production incident #3): a real
 * client trace proved app.open() itself can genuinely exceed the ordinary
 * 15s MCP call timeout, that the P1 generic transient-retry wrapper then
 * re-issued app.open() on every one of 3 consecutive timeouts, and that
 * MCP/stdio has no cancellation guarantee - so an abandoned-by-us open
 * request may still be running (or queued) on the bridge when a fresh one
 * is fired. A live, read-only CHECK_HEALTH dispatch ~48 minutes later
 * proved AE was STILL on "Untitled"/null - not "the open worked but the
 * response was slow." The three paths below replace that generic-retry
 * behavior:
 *
 *   1. Reuse: ae_health's own already-captured response (the cheap,
 *      always-called-anyway first discovery call) reports a project
 *      genuinely open at exactly the requested path - no open call is
 *      made at all. An unparseable/absent health.projectPath is NEVER
 *      treated as a match - only a real, positively-confirmed path
 *      match skips the open step.
 *   2. Open (EXACTLY ONCE): otherwise, runs buildOpenProjectScript (a
 *      fixed, versioned, allowlisted script - never arbitrary JSX) via a
 *      single direct client.runFixedInspectionScript call with its own
 *      OPEN_PROJECT_TIMEOUT_MS - deliberately NOT wrapped in
 *      callWithTransientRetry, so a transient MCP timeout on THIS call
 *      can never cause a second app.open() invocation. This is the one
 *      and only app.open() call this function can ever make.
 *   3. Poll-not-reopen: if that single attempt returns ok - a real
 *      response, whether success or a deterministic script-level failure
 *      - it is trusted immediately (no polling needed, an answer already
 *      exists). If it instead comes back as a TRANSPORT_ERROR (the
 *      timeout case), this does NOT retry app.open() - it polls
 *      read-only ae_health (see pollForProjectOpen above) for up to
 *      OPEN_PROJECT_POLL_BUDGET_MS more, checking whether the target path
 *      eventually converges on its own. Every failure path - immediate
 *      script failure, unparseable response, wrong-shape response, a
 *      poll-discovered wrong project, or a poll budget exhausted with no
 *      project ever appearing - reports `matched: false` with a distinct,
 *      actionable note, never silently treated as success.
 */
async function ensureTargetProjectOpen(
  client: HeroicSwanMcpClient,
  sourceProjectPath: string,
  healthCapture: RawToolCallCapture,
  logger: pino.Logger | undefined,
  retryOptions: TransientRetryOptions | undefined,
  openProjectOptions: OpenProjectOptions | undefined
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

  const timeoutMs = openProjectOptions?.timeoutMs ?? OPEN_PROJECT_TIMEOUT_MS;
  const pollBudgetMs = openProjectOptions?.pollBudgetMs ?? OPEN_PROJECT_POLL_BUDGET_MS;
  const pollIntervalMs = openProjectOptions?.pollIntervalMs ?? OPEN_PROJECT_POLL_INTERVAL_MS;

  // Exactly one app.open() invocation, structurally: a single direct call,
  // never routed through callWithTransientRetry (see this function's own
  // doc comment, point 2).
  const script = buildOpenProjectScript(sourceProjectPath);
  const openResult: ToolCallResult = await client.runFixedInspectionScript(script, timeoutMs);

  if (!openResult.ok) {
    if (openResult.error.code === "TRANSPORT_ERROR") {
      // Timeout, not a deterministic failure - poll instead of reopening.
      return {
        requestedPath: sourceProjectPath,
        ...(await pollForProjectOpen(client, sourceProjectPath, logger, retryOptions, pollIntervalMs, Date.now() + pollBudgetMs)),
        reused: false
      };
    }
    return {
      requestedPath: sourceProjectPath,
      actualOpenedPath: null,
      reused: false,
      matched: false,
      note: `the open command failed immediately (${openResult.error.message})`
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
      note: `the open command failed immediately (the open-project script itself reported a failure: ${parsed.data.failureReason})`
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
