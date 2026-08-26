import type { SceneEvidenceRequest, SceneEvidenceResponse } from "@dyo/schemas";

/**
 * Deterministic, read-only per-scene evidence acquisition (Phase 7B).
 * Implementations must:
 *   - never save the .aep,
 *   - never modify layers, effects, or project state,
 *   - never render a full composition (a single still-frame preview
 *     capture via ae_capture_frame is the only exception - see
 *     heroic-swan-scene-evidence-inspector.ts),
 *   - never execute JSX/bridge calls outside the allowlisted tools in
 *     heroic-swan-mcp-client.ts.
 * Unlike TemplateInspector (whole-project discovery), this always targets
 * exactly one composition and a bounded set of its layers - never all 45
 * compositions in one call.
 */
export interface SceneEvidenceInspector {
  inspect(request: SceneEvidenceRequest): Promise<SceneEvidenceResult>;
}

export interface SceneEvidenceFailure {
  kind: "failure";
  reason: string;
}

export interface SceneEvidenceSuccess {
  kind: "evidence";
  response: SceneEvidenceResponse;
}

export type SceneEvidenceResult = SceneEvidenceFailure | SceneEvidenceSuccess;

export class SceneEvidenceTransportUnavailableError extends Error {
  constructor(reason?: string) {
    super(reason ?? "INSPECT_SCENE_EVIDENCE cannot run: no real ae-mcp transport is configured (AE_MCP_PATH is unset).");
    this.name = "SceneEvidenceTransportUnavailableError";
  }
}

/** Honest stub, mirroring NotAvailableTemplateInspector - never fabricates a result. */
export class NotAvailableSceneEvidenceInspector implements SceneEvidenceInspector {
  async inspect(_request: SceneEvidenceRequest): Promise<SceneEvidenceResult> {
    throw new SceneEvidenceTransportUnavailableError();
  }
}
