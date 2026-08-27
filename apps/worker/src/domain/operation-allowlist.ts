import { WORKER_CAPABILITIES, type WorkerCapability } from "@dyo/schemas";

/**
 * The full set of operations this worker design recognizes at all, per
 * docs/MASTER_PLAN.md and CLAUDE.md's Phase 2 allowlist. This is the single
 * gate an incoming job command must pass before any AE/MCP/render adapter is
 * invoked - see docs/engineering/SECURITY.md ("worker accepts only predefined
 * operation types"). No operation outside WORKER_CAPABILITIES is ever valid,
 * and none of them map to arbitrary shell/PowerShell/JSX execution.
 */
const ALLOWED_OPERATIONS = new Set<string>(WORKER_CAPABILITIES);

export function isAllowedOperation(operation: string): operation is WorkerCapability {
  return ALLOWED_OPERATIONS.has(operation);
}

/**
 * Capabilities this worker build can actually perform today - adding a
 * capability here must happen alongside the phase that implements it.
 * INSPECT_TEMPLATE added once HeroicSwanTemplateInspector (a real,
 * read-only implementation gated on AE/MCP confirmed ONLINE - see
 * job-dispatcher.ts) replaced NotAvailableTemplateInspector in the real
 * worker execution path. Purely informational today: this list is
 * self-reported at registration/heartbeat time and is not currently used
 * by the API to gate which jobs get created or claimed.
 */
export const CURRENT_WORKER_CAPABILITIES: readonly WorkerCapability[] = [
  "CHECK_HEALTH",
  "INSPECT_TEMPLATE",
  "INSPECT_SCENE_EVIDENCE",
  "INSPECT_RENDER_CAPABILITIES",
  "EXECUTE_FRAME",
  "RENDER"
];
