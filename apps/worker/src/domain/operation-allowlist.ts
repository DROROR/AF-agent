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
 * worker execution path. Self-reported at registration/heartbeat time and
 * persisted on the worker's own DB row - apps/api/src/application/job/
 * dispatch-job.ts's `worker.capabilities.includes(request.operation)`
 * check gates every job dispatch against exactly this list, so a worker
 * whose build does not yet report a given capability can never be handed
 * a job for it (integration-tested: "rejects a worker that does not
 * report the INSPECT_TEMPLATE capability").
 */
export const CURRENT_WORKER_CAPABILITIES: readonly WorkerCapability[] = [
  "CHECK_HEALTH",
  "INSPECT_TEMPLATE",
  "INSPECT_SCENE_EVIDENCE",
  "INSPECT_RENDER_CAPABILITIES",
  "EXECUTE_FRAME",
  "RENDER",
  "CREATE_PREVIEW"
];
