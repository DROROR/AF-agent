import type { InspectTemplateRequest, InspectTemplateResponse } from "@dyo/schemas";
import type { AllowedInspectionTool } from "./heroic-swan-mcp-client.js";

/**
 * Deterministic, read-only AE template inspection. Implementations must:
 *   - never save the .aep,
 *   - never modify layers or project state,
 *   - never render,
 *   - never execute JSX/bridge calls outside allowed-inspection-queries.ts.
 * See docs/TEMPLATE-INSPECTOR.md for the full architecture.
 */
export interface TemplateInspector {
  inspect(request: InspectTemplateRequest): Promise<InspectTemplateResult>;
}

/**
 * One real, allowlisted MCP tool call captured verbatim - never re-shaped
 * or guessed at. `content` is upstream's raw MCP response content for that
 * tool, bounded in size (see MAX_CAPTURED_CONTENT_CHARS in
 * heroic-swan-template-inspector.ts) - never assumed to contain any
 * particular field.
 */
export interface RawToolCallCapture {
  tool: AllowedInspectionTool;
  calledAt: string;
  ok: boolean;
  /** Present when ok is true. If `truncated` is also true, this is a truncated JSON string, not necessarily valid JSON - see `truncated`/`originalContentLength`. */
  content?: unknown;
  truncated?: boolean;
  originalContentLength?: number;
  /** Present when ok is false. */
  error?: { code: string; message: string };
}

/**
 * First-pass INSPECT_TEMPLATE result: the real upstream ae-mcp tool
 * response shapes are not confirmed yet (see docs/TEMPLATE-INSPECTOR.md),
 * so this captures what the read-only tools actually returned instead of
 * forcing it into a guessed TemplateManifest field mapping - exactly the
 * mistake already made twice this session with ae-mcp's other undocumented
 * internals. Once a real captured sample confirms the tools' actual
 * response shapes, a later pass can build the real TemplateManifest
 * mapping from it, the same way the ae-mcp instance.json schema was only
 * trusted once a real sample existed.
 */
export interface RawInspectionCapture {
  kind: "raw_capture";
  /** Stamped by job-dispatcher.ts, which owns job identity - the inspector itself does not know its own job/worker IDs. */
  workerId?: string;
  jobId?: string;
  capturedAt: string;
  toolCalls: RawToolCallCapture[];
  note: string;
}

/** A finalized TemplateManifest, once real response schemas are confirmed and a real mapping exists. Not produced by any inspector yet. */
export interface ManifestInspectionResult {
  kind: "manifest";
  response: InspectTemplateResponse;
}

export type InspectTemplateResult = RawInspectionCapture | ManifestInspectionResult;

export class InspectionTransportUnavailableError extends Error {
  constructor(reason?: string) {
    super(
      reason ??
        "INSPECT_TEMPLATE cannot run: no real ae-mcp transport is configured " +
          "(AE_MCP_PATH is unset). This is a boundary/contract placeholder, not a " +
          "broken implementation - see docs/TEMPLATE-INSPECTOR.md."
    );
    this.name = "InspectionTransportUnavailableError";
  }
}

/**
 * Honest stub - mirrors AfterEffectsRenderer (packages/renderer): never
 * fabricates a result, always fails loudly with a clear reason. No longer
 * used in the real worker execution path (see index.ts, which always
 * constructs HeroicSwanTemplateInspector) - kept as a minimal reference
 * implementation of the interface and for tests that need a
 * guaranteed-unavailable inspector without depending on ae-mcp at all.
 */
export class NotAvailableTemplateInspector implements TemplateInspector {
  async inspect(_request: InspectTemplateRequest): Promise<InspectTemplateResult> {
    throw new InspectionTransportUnavailableError();
  }
}
