import { describe, expect, it } from "vitest";
import { PROJECT_SCAN_SLICE_MAX_ATTEMPTS, retryScanSliceOnBridgeTimeout } from "./heroic-swan-template-inspector.js";
import type { ToolCallResult } from "./heroic-swan-mcp-client.js";

/**
 * REAL 2026-10-04 INCIDENT: one scan slice hit the bridge's 30-second limit
 * while After Effects was briefly not answering, and the whole project-wide
 * scan was thrown away - the template came back with no editable
 * placeholders at all.
 */

const bridgeTimeout: ToolCallResult = {
  ok: false,
  error: { code: "TOOL_ERROR", message: "[AE_TIMEOUT] Timed out after 30000ms waiting for After Effects (method: system.runJsx)" }
};
const otherFailure: ToolCallResult = { ok: false, error: { code: "TOOL_ERROR", message: "script reported a failure" } };
const answered: ToolCallResult = { ok: true, content: [] };

function slice(results: ToolCallResult[]) {
  let calls = 0;
  return {
    ask: async () => results[Math.min(calls++, results.length - 1)]!,
    calls: () => calls
  };
}
const range = { firstItem: 1, lastItem: 10, delayMs: 0 };

describe("a scan slice After Effects did not answer in time is asked for again", () => {
  it("a slice answered the first time is asked for once", async () => {
    const s = slice([answered]);
    expect(await retryScanSliceOnBridgeTimeout(s.ask, range)).toBe(answered);
    expect(s.calls()).toBe(1);
  });

  it("one silence, then an answer: the scan goes on", async () => {
    const s = slice([bridgeTimeout, answered]);
    expect(await retryScanSliceOnBridgeTimeout(s.ask, range)).toBe(answered);
    expect(s.calls()).toBe(2);
  });

  it("After Effects never answers: stops after the bounded attempts and reports the bridge's own failure", async () => {
    const s = slice([bridgeTimeout]);
    expect(await retryScanSliceOnBridgeTimeout(s.ask, range)).toBe(bridgeTimeout);
    expect(s.calls()).toBe(PROJECT_SCAN_SLICE_MAX_ATTEMPTS);
  });

  it("any other failure is never repeated", async () => {
    const s = slice([otherFailure, answered]);
    expect(await retryScanSliceOnBridgeTimeout(s.ask, range)).toBe(otherFailure);
    expect(s.calls()).toBe(1);
  });
});
