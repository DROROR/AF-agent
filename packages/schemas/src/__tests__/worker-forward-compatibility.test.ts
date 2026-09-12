import { describe, expect, it } from "vitest";
import { heartbeatRequestSchema, registerWorkerRequestSchema, WORKER_CAPABILITIES } from "../worker.js";

/**
 * REAL SHIP-BLOCKER FOUND 2026-09-12, BEFORE IT REACHED THE CLIENT.
 *
 * The worker reports its capabilities on every heartbeat, and this schema
 * validated them against a strict enum. A worker running a build newer than
 * the deployed API - which is the normal state during any rollout, and the
 * permanent state if the operator installs the worker update before the API
 * is deployed - would have failed validation, taken a 400 on every single
 * heartbeat, and gone permanently OFFLINE on a machine nobody can reach.
 */
describe("worker capability forward compatibility", () => {
  it("DROPS an unknown capability from a heartbeat instead of rejecting the whole heartbeat", () => {
    const parsed = heartbeatRequestSchema.parse({
      aeStatus: "ONLINE",
      mcpStatus: "ONLINE",
      aeVersion: "26.3x87",
      capabilities: ["CHECK_HEALTH", "SOME_FUTURE_CAPABILITY", "INSPECT_TEMPLATE"],
      currentJobId: null
    });

    expect(parsed.capabilities).toEqual(["CHECK_HEALTH", "INSPECT_TEMPLATE"]);
  });

  it("keeps a heartbeat valid even when EVERY reported capability is unknown", () => {
    const parsed = heartbeatRequestSchema.parse({
      aeStatus: "ONLINE",
      mcpStatus: "UNKNOWN",
      aeVersion: null,
      capabilities: ["A_CAPABILITY_FROM_THE_FUTURE"],
      currentJobId: null
    });
    expect(parsed.capabilities).toEqual([]);
  });

  it("applies the same rule at registration, which has the same rollout-ordering exposure", () => {
    const parsed = registerWorkerRequestSchema.parse({
      name: "FAHADNAKASH",
      pairingSecret: "x".repeat(16),
      capabilities: ["RENDER", "NOT_A_REAL_CAPABILITY"]
    });
    expect(parsed.capabilities).toEqual(["RENDER"]);
  });

  it("still accepts every genuinely known capability unchanged", () => {
    const parsed = heartbeatRequestSchema.parse({
      aeStatus: "ONLINE",
      mcpStatus: "ONLINE",
      aeVersion: "26.3x87",
      capabilities: [...WORKER_CAPABILITIES],
      currentJobId: null
    });
    expect(parsed.capabilities).toEqual([...WORKER_CAPABILITIES]);
  });

  // Dropping unknown names must NOT become a way to sneak an operation past
  // the dispatch gate: what is dropped is simply absent, so
  // `worker.capabilities.includes(operation)` still refuses it.
  it("records the new diagnostic capabilities only because THIS build knows them", () => {
    const parsed = heartbeatRequestSchema.parse({
      aeStatus: "ONLINE",
      mcpStatus: "ONLINE",
      aeVersion: "26.3x87",
      capabilities: ["RUN_DIAGNOSTIC", "RESTART_WORKER_SAFE"],
      currentJobId: null
    });
    expect(parsed.capabilities).toEqual(["RUN_DIAGNOSTIC", "RESTART_WORKER_SAFE"]);
  });

  it("still rejects a non-array capabilities value", () => {
    expect(() =>
      heartbeatRequestSchema.parse({ aeStatus: "ONLINE", mcpStatus: "ONLINE", capabilities: "CHECK_HEALTH", currentJobId: null })
    ).toThrow();
  });
});
