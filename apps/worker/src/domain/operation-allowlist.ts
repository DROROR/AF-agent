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
 * Capabilities this worker build can actually perform today. Phase 2 only
 * implements read-only health detection, so it claims nothing else - adding a
 * capability here must happen alongside the phase that implements it.
 */
export const CURRENT_WORKER_CAPABILITIES: readonly WorkerCapability[] = ["CHECK_HEALTH"];
