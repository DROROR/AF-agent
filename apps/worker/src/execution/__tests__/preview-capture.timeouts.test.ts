import { describe, expect, it } from "vitest";
import { DEFAULT_CAPTURE_CALL_TIMEOUT_MS, DEFAULT_CAPTURE_CONNECT_TIMEOUT_MS, HeroicSwanPreviewCapture } from "../preview-capture.js";

describe("HeroicSwanPreviewCapture bounds (real 2026-09-15: ae_capture_frame timed out at the 15 s default after nine edits)", () => {
  it("defaults outlast a real still render of an edited scene, while still bounded", () => {
    const capture = new HeroicSwanPreviewCapture("C:\\AI-Tools\\ae-mcp");
    expect(capture.connectTimeoutMs).toBe(DEFAULT_CAPTURE_CONNECT_TIMEOUT_MS);
    expect(capture.callTimeoutMs).toBe(DEFAULT_CAPTURE_CALL_TIMEOUT_MS);
    expect(DEFAULT_CAPTURE_CALL_TIMEOUT_MS).toBeGreaterThan(15_000);
    expect(DEFAULT_CAPTURE_CALL_TIMEOUT_MS).toBeLessThanOrEqual(300_000);
    expect(DEFAULT_CAPTURE_CONNECT_TIMEOUT_MS).toBeGreaterThan(15_000);
  });

  it("explicit bounds override the defaults", () => {
    const capture = new HeroicSwanPreviewCapture("C:\\AI-Tools\\ae-mcp", { connectTimeoutMs: 1_000, callTimeoutMs: 2_000 });
    expect(capture.connectTimeoutMs).toBe(1_000);
    expect(capture.callTimeoutMs).toBe(2_000);
  });
});
