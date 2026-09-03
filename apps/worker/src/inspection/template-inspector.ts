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
 * P0 fix (2026-09-03, real production incident): proof that AE actually
 * had the REQUESTED sourceProjectPath open before any manifest facts were
 * read - mirrors packages/schemas/src/inspect-template.ts's own
 * projectOpenEvidenceSchema (kept as a separate local interface, same
 * convention as RawToolCallCapture/ManifestInspectionResult below).
 */
export interface ProjectOpenEvidence {
  requestedPath: string;
  actualOpenedPath: string | null;
  reused: boolean;
  matched: boolean;
  note?: string;
}

/**
 * Fallback INSPECT_TEMPLATE result for when a real TemplateManifest
 * cannot honestly be built: the P0 open/verify step could not confirm the
 * requested project was actually open, any of the four discovery tool
 * calls failed or returned something that doesn't match the confirmed
 * shape (parse-mcp-shapes.ts), or the real source .aep at
 * sourceProjectPath could not be hashed (CLAUDE.md Safety Rule 8).
 * Captures exactly what the read-only tools actually returned instead of
 * forcing it into a guessed mapping - never a crash, never a fabricated
 * manifest.
 */
export interface RawInspectionCapture {
  kind: "raw_capture";
  /** Stamped by job-dispatcher.ts, which owns job identity - the inspector itself does not know its own job/worker IDs. */
  workerId?: string;
  jobId?: string;
  capturedAt: string;
  toolCalls: RawToolCallCapture[];
  note: string;
  /** Present only when the P0 open/verify step itself ran and is the reason for this fallback - see ProjectOpenEvidence's own doc comment. */
  projectOpenEvidence?: ProjectOpenEvidence;
}

/**
 * A finalized, schema-validated TemplateManifest, built from real,
 * confirmed MCP response shapes (see parse-mcp-shapes.ts,
 * build-project-facts.ts). `diagnostics` retains the bounded raw capture
 * of the four top-level tool calls this was built from - never required
 * by any consumer of `response`, kept only so a human/operator can see
 * exactly what ae-mcp returned if the built manifest ever looks wrong.
 * `projectOpenEvidence` is always present here with `matched: true` - a
 * manifest is never built unless the P0 open/verify step already
 * succeeded.
 */
export interface ManifestInspectionResult {
  kind: "manifest";
  response: InspectTemplateResponse;
  diagnostics: RawToolCallCapture[];
  projectOpenEvidence: ProjectOpenEvidence;
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
