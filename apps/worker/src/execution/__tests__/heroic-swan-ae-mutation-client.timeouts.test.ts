import { describe, expect, it } from "vitest";
import {
  DEFAULT_MUTATION_CALL_TIMEOUT_MS,
  DEFAULT_MUTATION_CONNECT_TIMEOUT_MS,
  HeroicSwanAeMutationClient
} from "../heroic-swan-ae-mutation-client.js";

describe("HeroicSwanAeMutationClient bounds (real 2026-09-14: AE busy >30 s after a large import)", () => {
  it("defaults outlast After Effects' observed post-import busy period, while still bounded", () => {
    const client = new HeroicSwanAeMutationClient({ aeMcpPath: "C:\\AI-Tools\\ae-mcp" });
    expect(client.connectTimeoutMs).toBe(DEFAULT_MUTATION_CONNECT_TIMEOUT_MS);
    expect(client.callTimeoutMs).toBe(DEFAULT_MUTATION_CALL_TIMEOUT_MS);
    // The old flat 30 s bound failed real runs; both are now longer, but never unbounded.
    expect(DEFAULT_MUTATION_CONNECT_TIMEOUT_MS).toBeGreaterThan(30_000);
    expect(DEFAULT_MUTATION_CALL_TIMEOUT_MS).toBeGreaterThan(30_000);
    expect(DEFAULT_MUTATION_CALL_TIMEOUT_MS).toBeLessThanOrEqual(180_000);
  });

  it("an explicit timeoutMs still overrides both bounds", () => {
    const client = new HeroicSwanAeMutationClient({ aeMcpPath: "C:\\AI-Tools\\ae-mcp", timeoutMs: 3_000 });
    expect(client.connectTimeoutMs).toBe(3_000);
    expect(client.callTimeoutMs).toBe(3_000);
  });
});
