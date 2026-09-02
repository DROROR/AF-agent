import type { McpStatus } from "@dyo/schemas";

export interface McpHealthResult {
  mcpStatus: McpStatus;
  mcpConfiguredPath: string | null;
  /**
   * Raw diagnostic detail behind mcpStatus - local-only (never part of the
   * heartbeat wire payload/schema, never sent to the server - see
   * build-heartbeat-payload.ts's explicit field whitelist). A real
   * incident's actual mechanism (which exit code, a timeout, a spawn
   * failure) would otherwise be lost the moment it collapses into the
   * coarser ONLINE/OFFLINE/UNKNOWN enum. A short, fixed vocabulary only -
   * never a raw error message/stack, which could contain a file path.
   */
  mcpProbeDetail: string;
}

/**
 * Plug point for the real ae-mcp bridge integration. The current
 * implementation (McpInstanceFileAdapter) discovers and reads ae-mcp's real
 * heartbeat files under its data root - see mcp-instance-file-adapter.ts.
 * Kept as an interface so a future protocol/transport change never needs to
 * touch any call site, only this interface and whichever class implements it.
 */
export interface McpAdapter {
  checkHealth(): Promise<McpHealthResult>;
}
