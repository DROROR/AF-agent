import type { McpStatus } from "@dyo/schemas";

export interface McpHealthResult {
  mcpStatus: McpStatus;
  mcpConfiguredPath: string | null;
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
