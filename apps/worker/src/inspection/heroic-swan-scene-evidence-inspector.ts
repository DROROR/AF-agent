import { z } from "zod";
import type { SceneEvidenceRequest, ScenePreview, LayerDetailFact, HostLayerRecord, CompositionSummary, LayerTransformFact, OutputLayoutProposal } from "@dyo/schemas";
import {
  compositionSummarySchema,
  hostLayerRecordSchema,
  layerDetailFactSchema,
  layerTransformFactSchema,
  proposeOutputLayout,
  REELS_OUTPUT_HEIGHT_PX,
  REELS_OUTPUT_WIDTH_PX
} from "@dyo/schemas";
import { HeroicSwanMcpClient, type McpChildTerminationLogger } from "./heroic-swan-mcp-client.js";
import type { SceneEvidenceInspector, SceneEvidenceResult } from "./scene-evidence-inspector.js";
import { parseCompositionDetail, parseLayerDetail } from "./parse-mcp-shapes.js";
import { hashSourceProject } from "./hash-source-project.js";
import { type CapturedFrameWaitOptions } from "./wait-for-captured-frame.js";
import { captureStill } from "./capture-still.js";

/** One still of a heavy composition takes longer than an inspection read; above the bridge's own 30 s so its specific error surfaces. */
export const SCENE_PREVIEW_CAPTURE_CALL_TIMEOUT_MS = 60_000;
import { withDisposableProject } from "./disposable-project.js";
import {
  buildDescribeCompositionSummaryScript,
  buildFindHostLayersScript,
  buildInspectCompositionLayerDetailsScript,
  buildInspectLayerTransformScript,
  buildDescribeLayerAtTimeScript,
  buildDescribeProjectFontsScript,
  type FixedJsxScript
} from "../execution/jsx-templates.js";
import { unwrapJsxResult } from "../execution/unwrap-jsx-result.js";
import { parseStableCompositionNumericId, resolveCompositionIndex } from "../execution/resolve-composition-index.js";
import type { JobExecutionRegistry } from "../runtime/job-execution-registry.js";
import { type OpenProjectOptions } from "./heroic-swan-template-inspector.js";

const layerDetailsScriptResultSchema = z.union([
  z.object({ ok: z.literal(true), layerDetails: z.array(layerDetailFactSchema) }).strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

/**
 * Live-QA "generic AE layer-discovery capability" requirement. Mirrors
 * heroic-swan-template-inspector.ts's own fetchPrecompFacts: best-effort,
 * never throws - a failure here is reported via layerDetailsFailureReason
 * and never fails the rest of the evidence result (the per-index `layers`
 * facts and any preview capture remain fully independent).
 */
async function fetchLayerDetails(
  client: HeroicSwanMcpClient,
  aeProjectItemIndex: number,
  compositionName: string,
  mode: "full" | "discovery" = "full"
): Promise<{ ok: true; layerDetails: LayerDetailFact[] } | { ok: false; reason: string }> {
  const script = buildInspectCompositionLayerDetailsScript(aeProjectItemIndex, compositionName, mode);
  const result = await client.runFixedInspectionScript(script);
  if (!result.ok) {
    return { ok: false, reason: `ae_run_jsx failed: ${result.error.message}` };
  }
  const unwrapped = unwrapJsxResult(result.content);
  if (!unwrapped.ok) {
    return { ok: false, reason: unwrapped.reason };
  }
  const parsed = layerDetailsScriptResultSchema.safeParse(unwrapped.value);
  if (!parsed.success) {
    return { ok: false, reason: `layer-details script response did not match the expected shape: ${parsed.error.message}` };
  }
  if (!parsed.data.ok) {
    return { ok: false, reason: parsed.data.failureReason };
  }
  return { ok: true, layerDetails: parsed.data.layerDetails };
}

const findHostLayersScriptResultSchema = z.union([
  z.object({ ok: z.literal(true), matches: z.array(hostLayerRecordSchema) }).strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

/**
 * Preview Timing Analysis targeted host-layer lookup (live QA, 2026-09-10
 * real incident, session a7fee3d9) - best-effort, never throws, mirrors
 * fetchLayerDetails's own shape exactly. A failure here is reported via
 * hostLayerRecordsFailureReason and never fails the rest of the evidence
 * result.
 */
async function fetchHostLayers(
  client: HeroicSwanMcpClient,
  aeProjectItemIndex: number,
  compositionName: string,
  childSourceCompositionId: string
): Promise<{ ok: true; matches: HostLayerRecord[] } | { ok: false; reason: string }> {
  const script = buildFindHostLayersScript(aeProjectItemIndex, compositionName, childSourceCompositionId);
  const result = await client.runFixedInspectionScript(script);
  if (!result.ok) {
    return { ok: false, reason: `ae_run_jsx failed: ${result.error.message}` };
  }
  const unwrapped = unwrapJsxResult(result.content);
  if (!unwrapped.ok) {
    return { ok: false, reason: unwrapped.reason };
  }
  const parsed = findHostLayersScriptResultSchema.safeParse(unwrapped.value);
  if (!parsed.success) {
    return { ok: false, reason: `find-host-layers script response did not match the expected shape: ${parsed.error.message}` };
  }
  if (!parsed.data.ok) {
    return { ok: false, reason: parsed.data.failureReason };
  }
  return { ok: true, matches: parsed.data.matches };
}

const describeCompositionSummaryScriptResultSchema = z.union([
  compositionSummarySchema.extend({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

/**
 * Real 2026-09-10 incident (session a7fee3d9) - best-effort, never
 * throws, mirrors fetchHostLayers's own shape exactly. A failure here is
 * reported via compositionSummaryFailureReason and never fails the rest
 * of the evidence result.
 */
async function fetchCompositionSummary(
  client: HeroicSwanMcpClient,
  aeProjectItemIndex: number,
  compositionName: string
): Promise<{ ok: true; summary: CompositionSummary } | { ok: false; reason: string }> {
  const script = buildDescribeCompositionSummaryScript(aeProjectItemIndex, compositionName);
  const result = await client.runFixedInspectionScript(script);
  if (!result.ok) {
    return { ok: false, reason: `ae_run_jsx failed: ${result.error.message}` };
  }
  const unwrapped = unwrapJsxResult(result.content);
  if (!unwrapped.ok) {
    return { ok: false, reason: unwrapped.reason };
  }
  const parsed = describeCompositionSummaryScriptResultSchema.safeParse(unwrapped.value);
  if (!parsed.success) {
    return { ok: false, reason: `describe-composition-summary script response did not match the expected shape: ${parsed.error.message}` };
  }
  if (!parsed.data.ok) {
    return { ok: false, reason: parsed.data.failureReason };
  }
  return {
    ok: true,
    summary: {
      compDurationSeconds: parsed.data.compDurationSeconds,
      workAreaStartSeconds: parsed.data.workAreaStartSeconds,
      workAreaDurationSeconds: parsed.data.workAreaDurationSeconds,
      frameRate: parsed.data.frameRate,
      layers: parsed.data.layers
    }
  };
}

const inspectLayerTransformScriptResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      /** The composition's own measured frame - nullable because an unreadable value is reported as null rather than guessed (see buildInspectLayerTransformScript). */
      compWidthPx: z.number().nullable().optional(),
      compHeightPx: z.number().nullable().optional(),
      layers: z.array(layerTransformFactSchema)
    })
    .strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

/**
 * Real 2026-09-11 nested-content audit (session a7fee3d9) - best-effort,
 * never throws, mirrors fetchCompositionSummary's own shape exactly. A
 * failure here is reported via layerTransformFactsFailureReason and
 * never fails the rest of the evidence result.
 */
async function fetchLayerTransforms(
  client: HeroicSwanMcpClient,
  aeProjectItemIndex: number,
  compositionName: string
): Promise<{ ok: true; layers: LayerTransformFact[]; compWidthPx: number | null; compHeightPx: number | null } | { ok: false; reason: string }> {
  const script = buildInspectLayerTransformScript(aeProjectItemIndex, compositionName);
  const result = await client.runFixedInspectionScript(script);
  if (!result.ok) {
    return { ok: false, reason: `ae_run_jsx failed: ${result.error.message}` };
  }
  const unwrapped = unwrapJsxResult(result.content);
  if (!unwrapped.ok) {
    return { ok: false, reason: unwrapped.reason };
  }
  const parsed = inspectLayerTransformScriptResultSchema.safeParse(unwrapped.value);
  if (!parsed.success) {
    return { ok: false, reason: `inspect-layer-transform script response did not match the expected shape: ${parsed.error.message}` };
  }
  if (!parsed.data.ok) {
    return { ok: false, reason: parsed.data.failureReason };
  }
  return { ok: true, layers: parsed.data.layers, compWidthPx: parsed.data.compWidthPx ?? null, compHeightPx: parsed.data.compHeightPx ?? null };
}

/**
 * REAL 2026-09-27 REELS-LAYOUT INCIDENT - derives the native 1080x1920
 * layout PROPOSAL from the layer scan that has just been read, using the
 * single deterministic rule in @dyo/schemas (output-layout-proposal.ts).
 *
 * Deliberately no second read of After Effects: the proposal is computed
 * from exactly the facts this same response already carries, so anyone
 * holding the response - the API, the dashboard, a test - can recompute
 * it and get the identical numbers. It is a proposal for a human to
 * review, never an instruction: the worker's own
 * BUILD_REELS_COMPOSITION continues to apply ONLY the layerTransforms
 * persisted on the approved plan.
 */
function deriveReelsLayoutProposal(scan: {
  layers: LayerTransformFact[];
  compWidthPx: number | null;
  compHeightPx: number | null;
}): { proposal: OutputLayoutProposal | null; failureReason: string | null } {
  if (scan.compWidthPx === null || scan.compHeightPx === null) {
    return { proposal: null, failureReason: "the layer scan did not report this composition's own frame size, so no layout can be derived from it" };
  }
  const result = proposeOutputLayout({
    sourceFrame: { widthPx: scan.compWidthPx, heightPx: scan.compHeightPx },
    targetFrame: { widthPx: REELS_OUTPUT_WIDTH_PX, heightPx: REELS_OUTPUT_HEIGHT_PX },
    layers: scan.layers
  });
  return result.ok ? { proposal: result.proposal, failureReason: null } : { proposal: null, failureReason: result.reason };
}

const describeLayerAtTimeScriptResultSchema = z.union([
  z.object({ ok: z.literal(true), facts: z.record(z.unknown()) }).strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

/**
 * REAL 2026-09-17 investigation (session 069b5891) - best-effort, never
 * throws, same shape as fetchLayerTransforms. Describes one layer at one time
 * (see buildDescribeLayerAtTimeScript); a failure is reported via
 * layerAtTimeFactsFailureReason and never fails the rest of the result.
 */
async function fetchLayerAtTime(
  client: HeroicSwanMcpClient,
  aeProjectItemIndex: number,
  compositionName: string,
  layerIndex: number,
  timeSeconds: number
): Promise<{ ok: true; facts: Record<string, unknown> } | { ok: false; reason: string }> {
  const script = buildDescribeLayerAtTimeScript(aeProjectItemIndex, compositionName, layerIndex, timeSeconds);
  const result = await client.runFixedInspectionScript(script);
  if (!result.ok) {
    return { ok: false, reason: `ae_run_jsx failed: ${result.error.message}` };
  }
  const unwrapped = unwrapJsxResult(result.content);
  if (!unwrapped.ok) {
    return { ok: false, reason: unwrapped.reason };
  }
  const parsed = describeLayerAtTimeScriptResultSchema.safeParse(unwrapped.value);
  if (!parsed.success) {
    return { ok: false, reason: `describe-layer-at-time script response did not match the expected shape: ${parsed.error.message}` };
  }
  if (!parsed.data.ok) {
    return { ok: false, reason: parsed.data.failureReason };
  }
  return { ok: true, facts: parsed.data.facts };
}

const describeProjectFontsScriptResultSchema = z.union([
  z.object({ ok: z.literal(true), facts: z.record(z.unknown()) }).strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

/** REAL 2026-09-17 brand/typography gate - best-effort, never throws, same shape as fetchLayerAtTime. */
async function fetchProjectFonts(client: HeroicSwanMcpClient): Promise<{ ok: true; facts: Record<string, unknown> } | { ok: false; reason: string }> {
  const result = await client.runFixedInspectionScript(buildDescribeProjectFontsScript());
  if (!result.ok) {
    return { ok: false, reason: `ae_run_jsx failed: ${result.error.message}` };
  }
  const unwrapped = unwrapJsxResult(result.content);
  if (!unwrapped.ok) {
    return { ok: false, reason: unwrapped.reason };
  }
  const parsed = describeProjectFontsScriptResultSchema.safeParse(unwrapped.value);
  if (!parsed.success) {
    return { ok: false, reason: `describe-project-fonts script response did not match the expected shape: ${parsed.error.message}` };
  }
  if (!parsed.data.ok) {
    return { ok: false, reason: parsed.data.failureReason };
  }
  return { ok: true, facts: parsed.data.facts };
}

/**
 * Real, production INSPECT_SCENE_EVIDENCE implementation (Phase 7B).
 * Reaches ae-mcp only through HeroicSwanMcpClient's allowlisted
 * ae_get_composition/ae_get_layer/ae_capture_frame tools - never
 * ae_run_jsx, never a write/mutation call, never `.save()`.
 *
 * Every layer/source-identity fact this worker cannot honestly obtain
 * from those tools (layer type, source item identity/dimensions/
 * duration, a text layer's value, nested-composition identity) is left
 * null on the returned LayerEvidence - never inferred from the layer's or
 * composition's display name. See scene-evidence.ts's module doc comment
 * for how this was confirmed from the real upstream host script.
 */
export class HeroicSwanSceneEvidenceInspector implements SceneEvidenceInspector {
  private readonly aeMcpPath: string | undefined;
  private readonly logger: McpChildTerminationLogger | undefined;
  private readonly jobExecutionRegistry: JobExecutionRegistry | undefined;
  private readonly openProjectOptions: OpenProjectOptions | undefined;
  private readonly capturedFrameWait: CapturedFrameWaitOptions | undefined;
  private readonly previewsDirectory: string | undefined;

  constructor(config: {
    aeMcpPath: string | undefined;
    /** Structured logger for terminate() log lines - optional, never required for correct behavior. */
    logger?: McpChildTerminationLogger;
    /** Registers the ae-mcp child process this inspect() call owns so a watchdog/shutdown can abort it - optional (omitted in most tests), but MUST be provided in production (see index.ts) for P1/P2's stuck-job recovery to actually reach this call's own MCP client. */
    jobExecutionRegistry?: JobExecutionRegistry;
    /** Test-only override for the open-project timeout/poll budget - production uses heroic-swan-template-inspector.ts's real constants. */
    openProjectOptions?: OpenProjectOptions;
    /** Test-only override for how long a captured frame is waited for on disk - production uses wait-for-captured-frame.ts's real constants. */
    capturedFrameWait?: CapturedFrameWaitOptions;
    /** Test-only: where the worker's own still capture writes - production uses capture-still.ts's default. */
    previewsDirectory?: string;
  }) {
    this.capturedFrameWait = config.capturedFrameWait;
    this.previewsDirectory = config.previewsDirectory;
    this.aeMcpPath = config.aeMcpPath;
    this.logger = config.logger;
    this.jobExecutionRegistry = config.jobExecutionRegistry;
    this.openProjectOptions = config.openProjectOptions;
  }

  async inspect(request: SceneEvidenceRequest): Promise<SceneEvidenceResult> {
    if (!this.aeMcpPath) {
      return { kind: "failure", reason: "AE_MCP_PATH is not configured" };
    }

    // CLAUDE.md Safety Rule 8: verify the real source .aep still matches
    // the expected hash before ever reporting evidence about it - never
    // describe a project that has since changed.
    const hashResult = await hashSourceProject(request.sourceProjectPath);
    if (!hashResult.ok) {
      return { kind: "failure", reason: `Could not hash sourceProjectPath (${hashResult.reason})` };
    }
    if (hashResult.value.sha256 !== request.sourceProjectSha256) {
      return {
        kind: "failure",
        reason: `sourceProjectPath's current sha256 (${hashResult.value.sha256}) does not match the requested sourceProjectSha256 (${request.sourceProjectSha256}) - the source project has changed`
      };
    }

    const client = new HeroicSwanMcpClient({
      aeMcpPath: this.aeMcpPath,
      ...(this.logger !== undefined ? { logger: this.logger } : {})
    });
    // Registered BEFORE connect() (2026-09-04 P0/P1 fix) - see
    // job-execution-registry.ts's own doc comment on why even a hang
    // during the initial handshake must be abortable, not just a hang
    // inside a later callTool().
    const unregister = this.jobExecutionRegistry?.registerMcpOwner(client);
    try {
      try {
        await client.connect();
      } catch (error) {
        await client.close();
        return { kind: "failure", reason: `Could not connect to ae-mcp (${error instanceof Error ? error.message : String(error)})` };
      }

      return await this.runInspection(client, request, hashResult.value.sha256);
    } finally {
      // REAL 2026-10-08 (client PC, GET_DYO_PROCESS_TREE): fourteen
      // `ae-mcp serve` processes were alive, each started at the second an
      // INSPECT_SCENE_EVIDENCE job began - successful ones included. This
      // call only ever closed its client when connect() failed; after a real
      // inspection the child was left running for the life of the worker.
      // close() is idempotent and never throws (HeroicSwanMcpClient.terminate),
      // and it runs before the owner is unregistered so a watchdog can still
      // reach the child while it is being closed.
      await client.close();
      unregister?.();
    }
  }

  private async runInspection(
    client: HeroicSwanMcpClient,
    request: SceneEvidenceRequest,
    verifiedSourceProjectSha256: string
  ): Promise<SceneEvidenceResult> {
    // STAGE 3 (2026-09-19): scene evidence is read from a DISPOSABLE COPY of
    // the requested project, never from the file itself. The wrapper creates
    // it beside the original (so relative footage still resolves), refuses to
    // disturb an unsaved project, restores whatever After Effects held,
    // re-hashes the protected files afterwards and cleans the copy up - see
    // disposable-project.ts.
    //
    // This replaces the previous "open the requested file and verify it"
    // step, which solved the same 2026-09-14 failure (evidence read from
    // whatever AE happened to hold) while leaving the real project open and
    // modifiable afterwards.
    const safe = await withDisposableProject(
      { runScript: (script, timeoutMs) => runInspectionScript(client, script, timeoutMs) },
      {
        operation: "INSPECT_SCENE_EVIDENCE",
        targetPath: request.sourceProjectPath,
        targetSha256: verifiedSourceProjectSha256,
        sourceProjectPath: request.sourceProjectPath,
        sourceProjectSha256: verifiedSourceProjectSha256
      },
      async () => this.captureEvidence(client, request, verifiedSourceProjectSha256)
    );
    if (!safe.ok) {
      return {
        kind: "failure",
        reason: `the scene's project could not be safely inspected (${safe.code}: ${safe.reason}). Nothing was changed: the project itself was never opened, and After Effects' own open project was left exactly as it was found.`
      };
    }
    return safe.value.kind === "evidence" ? { ...safe.value, response: { ...safe.value.response, safeInspection: safe.evidence } } : safe.value;
  }

  /** Everything this inspector reads once the disposable copy is open - it never opens or closes anything itself. */
  private async captureEvidence(
    client: HeroicSwanMcpClient,
    request: SceneEvidenceRequest,
    verifiedSourceProjectSha256: string
  ): Promise<SceneEvidenceResult> {
    {

      // CRITICAL SAFETY FIX (real 2026-09-11 incident, session a7fee3d9):
      // request.aeProjectItemIndex is only ever a snapshot of the
      // manifest's own last-observed position - BUILD_HORIZONTAL_
      // COMPOSITION/BUILD_REELS_COMPOSITION each insert a new top-level
      // composition item and shift every later index, and nothing
      // re-scans/refreshes a pre-existing composition's own manifest
      // index afterward (see resolve-composition-index.ts's own doc
      // comment for the full incident trace). Before ever trusting the
      // request's own index, try to re-resolve it from the manifest's
      // durable numeric composition id (parsed from manifestCompositionId
      // - "comp-" + AE's own persistent CompItem.id, never the ordinal
      // position). A composition whose id was never captured this way
      // (e.g. a BUILD_HORIZONTAL_COMPOSITION/BUILD_REELS_COMPOSITION
      // derived master - see that parser's own doc comment) has no
      // durable id to re-resolve by, so this falls back to the
      // request's own index unchanged for exactly that case - identical
      // to this function's prior behavior, no regression. When a durable
      // id DOES exist, resolution is authoritative: a failure here
      // (deleted composition, or a name mismatch even after an id match)
      // fails the whole request closed immediately, never silently
      // falling through to try the stale index anyway.
      let effectiveAeProjectItemIndex = request.aeProjectItemIndex;
      const stableNumericId = parseStableCompositionNumericId(request.manifestCompositionId);
      if (stableNumericId !== null) {
        const resolved = await resolveCompositionIndex((script) => client.runFixedInspectionScript(script), stableNumericId, request.compositionName);
        if (!resolved.ok) {
          return { kind: "failure", reason: `could not re-resolve composition "${request.manifestCompositionId}" by its durable id: ${resolved.reason}` };
        }
        effectiveAeProjectItemIndex = resolved.resolvedAeProjectItemIndex;
      }

      const compResult = await client.callTool("ae_get_composition", {
        comp_index: effectiveAeProjectItemIndex,
        response_format: "concise"
      });
      if (!compResult.ok) {
        return { kind: "failure", reason: `ae_get_composition failed: ${compResult.error.message}` };
      }
      const parsedComp = parseCompositionDetail(compResult.content);
      if (!parsedComp.ok) {
        return { kind: "failure", reason: `ae_get_composition response did not match the confirmed shape: ${parsedComp.reason}` };
      }

      // Canonical composition addressing safety net (section 8/9): never
      // trust aeProjectItemIndex alone - a stale manifest, a re-ordered
      // project item, or an off-by-one could resolve to the WRONG
      // composition that merely happens to be present at that index. The
      // resolved CompItem's own name must match what the caller expects
      // BEFORE any evidence is ever reported as fact. Still checked even
      // after a successful id-based resolution above (belt-and-suspenders
      // - resolveCompositionIndex already checked the name itself, but
      // this keeps the two code paths' own guarantees independent).
      if (parsedComp.value.name !== request.compositionName) {
        return {
          kind: "failure",
          reason: `aeProjectItemIndex ${effectiveAeProjectItemIndex} resolved to composition "${parsedComp.value.name}", expected "${request.compositionName}" - refusing to report evidence for the wrong composition`
        };
      }

      const layers = [];
      for (const layerIndex of request.layerIndices) {
        const layerResult = await client.callTool("ae_get_layer", {
          comp_index: effectiveAeProjectItemIndex,
          layer_index: layerIndex,
          response_format: "detailed"
        });
        if (!layerResult.ok) {
          // Best-effort: one unreachable layer does not fail the whole
          // request - the caller sees exactly which indices are missing
          // from the returned `layers` array and can treat those as
          // still-unresolved, never fabricated.
          continue;
        }
        const parsedLayer = parseLayerDetail(layerResult.content);
        if (!parsedLayer.ok) {
          continue;
        }
        const layer = parsedLayer.value;
        layers.push({
          layerIndex: layer.index,
          name: layer.name,
          enabled: layer.enabled,
          nullLayer: layer.nullLayer,
          threeDLayer: layer.threeDLayer,
          inPointSeconds: layer.inPointSeconds,
          outPointSeconds: layer.outPointSeconds,
          startTimeSeconds: layer.startTimeSeconds,
          parentLayerName: layer.parentLayerName,
          opacityPercent: layer.opacityPercent,
          layerType: null,
          sourceItemName: null,
          sourceWidthPx: null,
          sourceHeightPx: null,
          sourceDurationSeconds: null,
          textValue: null,
          nestedCompositionId: null,
          evidenceSource: "AE_GET_LAYER" as const
        });
      }

      let preview: ScenePreview | null = null;
      let previewFailureReason: string | null = null;
      if (request.previewTimestampSeconds !== null) {
        // The worker's own capture, to a path it chose - see capture-still.ts
        // (2026-10-04): ae-mcp's ae_capture_frame tool lost its connection on
        // every still of a heavy composition. The file is verified by this
        // worker's own filesystem read, never from AE's self-report.
        const captured = await captureStill(client, {
          aeProjectItemIndex: effectiveAeProjectItemIndex,
          timestampSeconds: request.previewTimestampSeconds,
          callTimeoutMs: SCENE_PREVIEW_CAPTURE_CALL_TIMEOUT_MS,
          ...(this.capturedFrameWait !== undefined ? { capturedFrameWait: this.capturedFrameWait, ...(this.capturedFrameWait.timeoutMs !== undefined ? { waitAfterFailedCallMs: this.capturedFrameWait.timeoutMs } : {}) } : {}),
          ...(this.previewsDirectory !== undefined ? { previewsDirectory: this.previewsDirectory } : {})
        });
        if (captured.ok) {
          preview = { timestampSeconds: request.previewTimestampSeconds, path: captured.path, bytes: captured.bytes };
        } else {
          previewFailureReason = captured.reason;
        }
      }

      let layerDetails: LayerDetailFact[] | null = null;
      let layerDetailsFailureReason: string | null = null;
      if (request.discoverLayerDetails === true) {
        const layerDetailsResult = await fetchLayerDetails(
          client,
          effectiveAeProjectItemIndex,
          parsedComp.value.name,
          request.discoverLayerDetailsMode === "discovery" ? "discovery" : "full"
        );
        if (layerDetailsResult.ok) {
          layerDetails = layerDetailsResult.layerDetails;
        } else {
          layerDetailsFailureReason = layerDetailsResult.reason;
        }
      }

      let hostLayerRecords: HostLayerRecord[] | null = null;
      let hostLayerRecordsFailureReason: string | null = null;
      if (request.findHostLayersForChildCompositionId !== undefined) {
        const hostLayersResult = await fetchHostLayers(client, effectiveAeProjectItemIndex, parsedComp.value.name, request.findHostLayersForChildCompositionId);
        if (hostLayersResult.ok) {
          hostLayerRecords = hostLayersResult.matches;
        } else {
          hostLayerRecordsFailureReason = hostLayersResult.reason;
        }
      }

      let compositionSummary: CompositionSummary | null = null;
      let compositionSummaryFailureReason: string | null = null;
      if (request.describeCompositionSummary === true) {
        const summaryResult = await fetchCompositionSummary(client, effectiveAeProjectItemIndex, parsedComp.value.name);
        if (summaryResult.ok) {
          compositionSummary = summaryResult.summary;
        } else {
          compositionSummaryFailureReason = summaryResult.reason;
        }
      }

      let layerTransformFacts: LayerTransformFact[] | null = null;
      let layerTransformFactsFailureReason: string | null = null;
      // Added to the response ONLY when a layer scan actually succeeded -
      // see scene-evidence.ts. A response that carries no layer facts
      // never carries a layout proposal either.
      let reelsLayout: { reelsLayoutProposal: OutputLayoutProposal | null; reelsLayoutProposalFailureReason: string | null } | null = null;
      if (request.describeLayerTransforms === true) {
        const transformsResult = await fetchLayerTransforms(client, effectiveAeProjectItemIndex, parsedComp.value.name);
        if (transformsResult.ok) {
          layerTransformFacts = transformsResult.layers;
          const derived = deriveReelsLayoutProposal(transformsResult);
          reelsLayout = { reelsLayoutProposal: derived.proposal, reelsLayoutProposalFailureReason: derived.failureReason };
        } else {
          layerTransformFactsFailureReason = transformsResult.reason;
        }
      }

      // Added to the response ONLY when requested - see scene-evidence.ts.
      let layerAtTime: { layerAtTimeFacts: Record<string, unknown> | null; layerAtTimeFactsFailureReason: string | null } | null = null;
      if (request.describeLayerAtTime !== undefined) {
        const layerAtTimeResult = await fetchLayerAtTime(
          client,
          effectiveAeProjectItemIndex,
          parsedComp.value.name,
          request.describeLayerAtTime.layerIndex,
          request.describeLayerAtTime.timeSeconds
        );
        layerAtTime = layerAtTimeResult.ok
          ? { layerAtTimeFacts: layerAtTimeResult.facts, layerAtTimeFactsFailureReason: null }
          : { layerAtTimeFacts: null, layerAtTimeFactsFailureReason: layerAtTimeResult.reason };
      }

      // Added to the response ONLY when requested - see scene-evidence.ts.
      let fonts: { fontFacts: Record<string, unknown> | null; fontFactsFailureReason: string | null } | null = null;
      if (request.describeFonts === true) {
        const fontsResult = await fetchProjectFonts(client);
        fonts = fontsResult.ok
          ? { fontFacts: fontsResult.facts, fontFactsFailureReason: null }
          : { fontFacts: null, fontFactsFailureReason: fontsResult.reason };
      }

      return {
        kind: "evidence",
        response: {
          verifiedSourceProjectSha256,
          manifestCompositionId: request.manifestCompositionId,
          aeProjectItemIndex: effectiveAeProjectItemIndex,
          compositionName: parsedComp.value.name,
          layers,
          preview,
          previewFailureReason,
          layerDetails,
          layerDetailsFailureReason,
          hostLayerRecords,
          hostLayerRecordsFailureReason,
          compositionSummary,
          compositionSummaryFailureReason,
          layerTransformFacts,
          layerTransformFactsFailureReason,
          ...(reelsLayout ?? {}),
          ...(layerAtTime ?? {}),
          ...(fonts ?? {}),
          capturedAt: new Date().toISOString()
        }
      };
    }
  }
}

/** One read-only script call, unwrapped into the shape the disposable-project wrapper expects. */
async function runInspectionScript(
  client: HeroicSwanMcpClient,
  script: FixedJsxScript,
  timeoutMs?: number
): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
  const result = await client.runFixedInspectionScript(script, timeoutMs);
  if (!result.ok) {
    return { ok: false, reason: `ae_run_jsx failed: ${result.error.message}` };
  }
  const unwrapped = unwrapJsxResult(result.content);
  return unwrapped.ok ? { ok: true, value: unwrapped.value } : { ok: false, reason: unwrapped.reason };
}
