import type { AeStatus, McpStatus } from "@dyo/schemas";
import type { ProcessLister } from "../infrastructure/process-lister.js";
import { detectAeHealth } from "./ae-health.js";
import type { McpAdapter } from "./mcp-adapter.js";

/** Full local health picture - a superset of what the heartbeat wire schema carries, used for structured logging and (later) the CHECK_HEALTH operation. */
export interface HealthSnapshot {
  aeStatus: AeStatus;
  aeVersion: string | null;
  aerenderAvailable: boolean;
  mcpStatus: McpStatus;
  mcpConfiguredPath: string | null;
}

export interface HealthSnapshotConfig {
  aePath: string | undefined;
  aerenderPath: string | undefined;
}

export async function buildHealthSnapshot(
  config: HealthSnapshotConfig,
  deps: { processLister: ProcessLister; mcpAdapter: McpAdapter }
): Promise<HealthSnapshot> {
  const [ae, mcp] = await Promise.all([
    detectAeHealth(config, deps.processLister),
    deps.mcpAdapter.checkHealth()
  ]);
  return {
    aeStatus: ae.aeStatus,
    aeVersion: ae.aeVersion,
    aerenderAvailable: ae.aerenderAvailable,
    mcpStatus: mcp.mcpStatus,
    mcpConfiguredPath: mcp.mcpConfiguredPath
  };
}
