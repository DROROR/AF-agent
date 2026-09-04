import { stat } from "node:fs/promises";
import type { SceneEvidenceRequest, ScenePreview } from "@dyo/schemas";
import { HeroicSwanMcpClient, type McpChildTerminationLogger } from "./heroic-swan-mcp-client.js";
import type { SceneEvidenceInspector, SceneEvidenceResult } from "./scene-evidence-inspector.js";
import { parseCaptureFrame, parseCompositionDetail, parseLayerDetail } from "./parse-mcp-shapes.js";
import { hashSourceProject } from "./hash-source-project.js";
import type { JobExecutionRegistry } from "../runtime/job-execution-registry.js";

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

  constructor(config: {
    aeMcpPath: string | undefined;
    /** Structured logger for terminate() log lines - optional, never required for correct behavior. */
    logger?: McpChildTerminationLogger;
    /** Registers the ae-mcp child process this inspect() call owns so a watchdog/shutdown can abort it - optional (omitted in most tests), but MUST be provided in production (see index.ts) for P1/P2's stuck-job recovery to actually reach this call's own MCP client. */
    jobExecutionRegistry?: JobExecutionRegistry;
  }) {
    this.aeMcpPath = config.aeMcpPath;
    this.logger = config.logger;
    this.jobExecutionRegistry = config.jobExecutionRegistry;
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
      unregister?.();
    }
  }

  private async runInspection(
    client: HeroicSwanMcpClient,
    request: SceneEvidenceRequest,
    verifiedSourceProjectSha256: string
  ): Promise<SceneEvidenceResult> {
    try {
      const compResult = await client.callTool("ae_get_composition", {
        comp_index: request.aeProjectItemIndex,
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
      // BEFORE any evidence is ever reported as fact.
      if (parsedComp.value.name !== request.compositionName) {
        return {
          kind: "failure",
          reason: `aeProjectItemIndex ${request.aeProjectItemIndex} resolved to composition "${parsedComp.value.name}", expected "${request.compositionName}" - refusing to report evidence for the wrong composition`
        };
      }

      const layers = [];
      for (const layerIndex of request.layerIndices) {
        const layerResult = await client.callTool("ae_get_layer", {
          comp_index: request.aeProjectItemIndex,
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
        const captureResult = await client.callTool("ae_capture_frame", {
          comp_index: request.aeProjectItemIndex,
          time: request.previewTimestampSeconds
        });
        if (!captureResult.ok) {
          previewFailureReason = `ae_capture_frame failed: ${captureResult.error.message}`;
        } else {
          const parsedCapture = parseCaptureFrame(captureResult.content);
          if (!parsedCapture.ok) {
            previewFailureReason = `ae_capture_frame response did not match either confirmed shape: ${parsedCapture.reason}`;
          } else {
            try {
              // Verified independently via this worker's own filesystem
              // stat call (worker and ae-mcp are co-located on the same
              // Windows machine) - never trusted from AE's self-report
              // alone. "actual verified image existence" (Phase 7B section 7).
              const fileStat = await stat(parsedCapture.value.path);
              if (!fileStat.isFile() || fileStat.size <= 0) {
                previewFailureReason = "captured preview file exists but is empty or not a regular file";
              } else {
                preview = {
                  timestampSeconds: request.previewTimestampSeconds,
                  path: parsedCapture.value.path,
                  bytes: fileStat.size
                };
              }
            } catch (error) {
              previewFailureReason = `could not verify the captured preview file on disk (${error instanceof Error ? error.message : String(error)})`;
            }
          }
        }
      }

      return {
        kind: "evidence",
        response: {
          verifiedSourceProjectSha256,
          manifestCompositionId: request.manifestCompositionId,
          aeProjectItemIndex: request.aeProjectItemIndex,
          compositionName: parsedComp.value.name,
          layers,
          preview,
          previewFailureReason,
          capturedAt: new Date().toISOString()
        }
      };
    } finally {
      await client.close();
    }
  }
}
