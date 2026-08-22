import { describe, expect, it } from "vitest";
import type { HealthSnapshot } from "../health/health-snapshot.js";
import { buildHeartbeatPayload } from "./build-heartbeat-payload.js";

const baseHealth: HealthSnapshot = {
  aeStatus: "ONLINE",
  aeVersion: "2026",
  aerenderAvailable: true,
  mcpStatus: "UNKNOWN",
  mcpConfiguredPath: null
};

describe("buildHeartbeatPayload", () => {
  it("maps health fields onto the heartbeat wire schema", () => {
    const payload = buildHeartbeatPayload(baseHealth);
    expect(payload.aeStatus).toBe("ONLINE");
    expect(payload.mcpStatus).toBe("UNKNOWN");
    expect(payload.aeVersion).toBe("2026");
  });

  it("always reports maxConcurrency 1 in Phase 2", () => {
    expect(buildHeartbeatPayload(baseHealth).maxConcurrency).toBe(1);
  });

  it("always reports currentJobId null - no job execution exists yet", () => {
    expect(buildHeartbeatPayload(baseHealth).currentJobId).toBeNull();
  });

  it("only claims capabilities this build actually implements", () => {
    expect(buildHeartbeatPayload(baseHealth).capabilities).toEqual(["CHECK_HEALTH"]);
  });

  it("passes through a null aeVersion unchanged", () => {
    const payload = buildHeartbeatPayload({ ...baseHealth, aeVersion: null });
    expect(payload.aeVersion).toBeNull();
  });
});
