import { describe, expect, it } from "vitest";
import type { WorkerDto } from "@dyo/schemas";
import { resolveProjectWorker } from "./resolve-project-worker";

const WORKER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const WORKER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function worker(overrides: Partial<WorkerDto> = {}): WorkerDto {
  return {
    workerId: WORKER_A,
    name: "Worker A",
    status: "ONLINE",
    lastHeartbeatAt: new Date().toISOString(),
    aeStatus: "ONLINE",
    mcpStatus: "ONLINE",
    aeAvailability: "ONLINE",
    mcpAvailability: "ONLINE",
    aeVersion: "26.0",
    capabilities: ["EXECUTE_FRAME", "INSPECT_SCENE_EVIDENCE", "CREATE_PREVIEW", "RENDER"],
    maxConcurrency: 1,
    currentJobId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("resolveProjectWorker (live QA Blocker 1)", () => {
  it("A: picks the project's own assigned Worker A even when an older/ONLINE Worker B also qualifies", () => {
    const a = worker({ workerId: WORKER_A });
    // Worker B: registered "earlier" (irrelevant here - order in the array
    // stands in for oldest-first), ONLINE, capable - exactly the shape that
    // used to win under the old oldest-first findDispatchableWorker heuristic.
    const b = worker({ workerId: WORKER_B, name: "Worker B (older)" });
    const result = resolveProjectWorker([b, a], "EXECUTE_FRAME", WORKER_A);
    expect(result?.workerId).toBe(WORKER_A);
  });

  it("B: Worker A unavailable (OFFLINE) - fails closed to null, never silently substitutes Worker B", () => {
    const a = worker({ workerId: WORKER_A, status: "OFFLINE" });
    const b = worker({ workerId: WORKER_B });
    const result = resolveProjectWorker([a, b], "EXECUTE_FRAME", WORKER_A);
    expect(result).toBeNull();
  });

  it("B: the project's assigned Worker is not even registered/known - fails closed to null, never falls back", () => {
    const b = worker({ workerId: WORKER_B });
    const result = resolveProjectWorker([b], "EXECUTE_FRAME", WORKER_A);
    expect(result).toBeNull();
  });

  it("C: the assigned Worker lacks the required capability - fails closed to null", () => {
    const a = worker({ workerId: WORKER_A, capabilities: ["CHECK_HEALTH"] });
    const result = resolveProjectWorker([a], "EXECUTE_FRAME", WORKER_A);
    expect(result).toBeNull();
  });

  it("D: the assigned Worker's MCP availability is UNKNOWN for an AE/MCP-dependent capability - fails closed to null", () => {
    const a = worker({ workerId: WORKER_A, mcpAvailability: "UNKNOWN" });
    const result = resolveProjectWorker([a], "INSPECT_SCENE_EVIDENCE", WORKER_A);
    expect(result).toBeNull();
  });

  it("does not gate a non-AE-dependent capability on aeAvailability/mcpAvailability for the assigned worker", () => {
    const a = worker({ workerId: WORKER_A, aeAvailability: "UNAVAILABLE", mcpAvailability: "UNAVAILABLE", capabilities: ["CHECK_HEALTH"] });
    const result = resolveProjectWorker([a], "CHECK_HEALTH", WORKER_A);
    expect(result?.workerId).toBe(WORKER_A);
  });

  it("F: falls back to the existing generic findDispatchableWorker heuristic, unchanged, when sourceWorkerId is null (no recorded provenance - a pre-migration or real client project)", () => {
    const a = worker({ workerId: WORKER_A });
    const b = worker({ workerId: WORKER_B });
    const result = resolveProjectWorker([a, b], "EXECUTE_FRAME", null);
    expect(result?.workerId).toBe(WORKER_A);
  });

  it("returns null when the worker list itself is null (dashboard status not loaded yet)", () => {
    expect(resolveProjectWorker(null, "EXECUTE_FRAME", WORKER_A)).toBeNull();
  });
});
