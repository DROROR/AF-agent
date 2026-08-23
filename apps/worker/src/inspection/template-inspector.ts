import type { InspectTemplateRequest, InspectTemplateResponse } from "@dyo/schemas";

/**
 * Deterministic, read-only AE template inspection. Implementations must:
 *   - never save the .aep,
 *   - never modify layers or project state,
 *   - never render,
 *   - never execute JSX/bridge calls outside allowed-inspection-queries.ts.
 * See docs/TEMPLATE-INSPECTOR.md for the full architecture and the
 * current transport blocker.
 */
export interface TemplateInspector {
  inspect(request: InspectTemplateRequest): Promise<InspectTemplateResponse>;
}

export class InspectionTransportUnavailableError extends Error {
  constructor() {
    super(
      "INSPECT_TEMPLATE cannot run yet: there is no job-dispatch transport between " +
        "the API and the worker (the worker's current command loop only sends " +
        "heartbeats - see apps/worker/src/runtime/heartbeat-loop.ts and " +
        "apps/worker/src/index.ts). A real ae-mcp bridge execution path is a " +
        "separate, also not-yet-built piece of work - its actual command protocol " +
        "has never been confirmed. This is a boundary/contract placeholder, not a " +
        "broken implementation - see docs/TEMPLATE-INSPECTOR.md."
    );
    this.name = "InspectionTransportUnavailableError";
  }
}

/**
 * Honest stub - mirrors AfterEffectsRenderer (packages/renderer) and
 * NotIntegratedMcpAdapter (apps/worker/src/health/mcp-adapter.ts): never
 * fabricates a result, always fails loudly with a clear reason.
 */
export class NotAvailableTemplateInspector implements TemplateInspector {
  async inspect(_request: InspectTemplateRequest): Promise<InspectTemplateResponse> {
    throw new InspectionTransportUnavailableError();
  }
}
