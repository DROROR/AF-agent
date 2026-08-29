import { describe, expect, it } from "vitest";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describeMcpFailure, isMcpTimeout } from "../classify-mcp-failure.js";

describe("classify-mcp-failure", () => {
  it("recognizes a real McpError RequestTimeout as a timeout", () => {
    const error = new McpError(ErrorCode.RequestTimeout, "Request timed out");
    expect(isMcpTimeout(error)).toBe(true);
  });

  it("does not classify an ordinary McpError (e.g. InternalError) as a timeout", () => {
    const error = new McpError(ErrorCode.InternalError, "something else went wrong");
    expect(isMcpTimeout(error)).toBe(false);
  });

  it("does not classify a plain Error (e.g. ECONNREFUSED) as a timeout", () => {
    expect(isMcpTimeout(new Error("connect ECONNREFUSED"))).toBe(false);
  });

  it("describes a real timeout with the honest AE_UNRESPONSIVE/BRIDGE_TIMEOUT classification - never claiming dedicated modal detection", () => {
    const error = new McpError(ErrorCode.RequestTimeout, "Request timed out");
    const message = describeMcpFailure(error);
    expect(message).toContain("AE_UNRESPONSIVE");
    expect(message).toContain("BRIDGE_TIMEOUT");
    expect(message).toContain("NEEDS HUMAN ACTION");
    // Honest about the limitation - explains modal dialogs as the likely
    // real-world cause, but never claims to have actually detected one.
    expect(message).toContain("exposes no API to directly detect");
    expect(message).not.toMatch(/modal dialog (was |is )?detected/i);
  });

  it("describes a non-timeout transport failure as a plain transport error, never the AE_UNRESPONSIVE classification", () => {
    const message = describeMcpFailure(new Error("connect ECONNREFUSED"));
    expect(message).toBe("ae-mcp transport error: connect ECONNREFUSED");
    expect(message).not.toContain("AE_UNRESPONSIVE");
  });
});
