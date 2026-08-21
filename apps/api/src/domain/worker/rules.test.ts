import { describe, expect, it } from "vitest";
import { isHeartbeatStale } from "./rules.js";

describe("isHeartbeatStale", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("is stale when there has never been a heartbeat", () => {
    expect(isHeartbeatStale(null, now, 30_000)).toBe(true);
  });

  it("is not stale when the heartbeat is within the window", () => {
    const lastHeartbeatAt = new Date(now.getTime() - 10_000);
    expect(isHeartbeatStale(lastHeartbeatAt, now, 30_000)).toBe(false);
  });

  it("is stale once the heartbeat exceeds the window", () => {
    const lastHeartbeatAt = new Date(now.getTime() - 30_001);
    expect(isHeartbeatStale(lastHeartbeatAt, now, 30_000)).toBe(true);
  });

  it("treats exactly the threshold as not yet stale", () => {
    const lastHeartbeatAt = new Date(now.getTime() - 30_000);
    expect(isHeartbeatStale(lastHeartbeatAt, now, 30_000)).toBe(false);
  });
});
