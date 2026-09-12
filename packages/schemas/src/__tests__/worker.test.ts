import { describe, expect, it } from "vitest";
import {
  heartbeatRequestSchema,
  registerWorkerRequestSchema,
  workerCapabilitySchema
} from "../worker.js";

describe("registerWorkerRequestSchema", () => {
  it("accepts a minimal valid payload and applies defaults", () => {
    const result = registerWorkerRequestSchema.parse({ name: "Client PC 1" });
    expect(result).toEqual({ name: "Client PC 1", maxConcurrency: 1, capabilities: [] });
  });

  it("rejects a blank name", () => {
    expect(() => registerWorkerRequestSchema.parse({ name: "" })).toThrow();
  });

  it("rejects zero or negative maxConcurrency", () => {
    expect(() =>
      registerWorkerRequestSchema.parse({ name: "Worker", maxConcurrency: 0 })
    ).toThrow();
  });

  // Behaviour deliberately changed 2026-09-12: this used to REJECT the whole
  // request. Rejecting made the control plane brittle in the one direction
  // that matters operationally - a worker newer than the API goes permanently
  // OFFLINE on a machine nobody can reach (see
  // worker-forward-compatibility.test.ts). The SECURITY property this test
  // exists to protect is unchanged and asserted directly below: a capability
  // outside the allowlist is never recorded, so dispatch-job.ts's
  // `worker.capabilities.includes(operation)` gate can never hand one out.
  it("never records a capability outside the allowlist", () => {
    const parsed = registerWorkerRequestSchema.parse({
      name: "Worker",
      capabilities: ["DELETE_EVERYTHING", "CHECK_HEALTH"]
    });

    expect(parsed.capabilities).toEqual(["CHECK_HEALTH"]);
    expect(parsed.capabilities).not.toContain("DELETE_EVERYTHING");
  });
});

describe("heartbeatRequestSchema", () => {
  it("accepts a full valid heartbeat", () => {
    const result = heartbeatRequestSchema.parse({
      aeStatus: "ONLINE",
      mcpStatus: "ONLINE",
      aeVersion: "26.0",
      currentJobId: null
    });
    expect(result.aeStatus).toBe("ONLINE");
  });

  it("rejects an invalid aeStatus value", () => {
    expect(() =>
      heartbeatRequestSchema.parse({ aeStatus: "RUNNING", mcpStatus: "ONLINE" })
    ).toThrow();
  });
});

describe("workerCapabilitySchema", () => {
  it("accepts every allowlisted capability", () => {
    expect(() => workerCapabilitySchema.parse("RENDER")).not.toThrow();
    expect(() => workerCapabilitySchema.parse("INSPECT_TEMPLATE")).not.toThrow();
  });
});
