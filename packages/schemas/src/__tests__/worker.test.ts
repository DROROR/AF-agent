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

  it("rejects a capability outside the allowlist", () => {
    expect(() =>
      registerWorkerRequestSchema.parse({
        name: "Worker",
        capabilities: ["DELETE_EVERYTHING"]
      })
    ).toThrow();
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
