import type { McpStatus } from "@dyo/schemas";

export interface McpHealthResult {
  mcpStatus: McpStatus;
  mcpConfiguredPath: string | null;
}

/**
 * Plug point for the real ae-mcp bridge integration, deferred until the real
 * Windows preflight/audit is complete (CLAUDE.md Phase 2 task 11). Swapping
 * in a real implementation later must not require touching any call site -
 * only this interface and its factory.
 */
export interface McpAdapter {
  checkHealth(): Promise<McpHealthResult>;
}

/**
 * ae-mcp is not integrated yet, so this never reports ONLINE/OFFLINE - doing
 * so would be fabricating a status we cannot actually verify (Phase 2's "do
 * not fabricate MCP health"). It only surfaces the configured path, if any,
 * for operator visibility.
 */
export class NotIntegratedMcpAdapter implements McpAdapter {
  constructor(private readonly mcpPath: string | undefined) {}

  async checkHealth(): Promise<McpHealthResult> {
    return { mcpStatus: "UNKNOWN", mcpConfiguredPath: this.mcpPath ?? null };
  }
}
