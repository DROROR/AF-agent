import { describe, expect, it } from "vitest";
import { NotIntegratedMcpAdapter } from "./mcp-adapter.js";

describe("NotIntegratedMcpAdapter", () => {
  it("never reports ONLINE or OFFLINE, only UNKNOWN", async () => {
    const adapter = new NotIntegratedMcpAdapter("C:\\ae-mcp\\config.json");
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });

  it("surfaces the configured path for visibility without fabricating health", async () => {
    const adapter = new NotIntegratedMcpAdapter("C:\\ae-mcp\\config.json");
    const result = await adapter.checkHealth();
    expect(result.mcpConfiguredPath).toBe("C:\\ae-mcp\\config.json");
  });

  it("reports a null path when ae-mcp is not configured at all", async () => {
    const adapter = new NotIntegratedMcpAdapter(undefined);
    const result = await adapter.checkHealth();
    expect(result.mcpConfiguredPath).toBeNull();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });
});
