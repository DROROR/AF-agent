import { describe, expect, it, vi } from "vitest";
import { JobExecutionRegistry } from "./job-execution-registry.js";
import type { McpChildOwner, McpChildTerminationOutcome } from "../inspection/heroic-swan-mcp-client.js";

function fakeOwner(outcome: McpChildTerminationOutcome): McpChildOwner & { terminate: ReturnType<typeof vi.fn> } {
  return { terminate: vi.fn(async () => outcome) };
}

describe("JobExecutionRegistry", () => {
  it("has no active job initially", () => {
    const registry = new JobExecutionRegistry();
    expect(registry.hasActiveJob()).toBe(false);
    expect(registry.getActiveJob()).toBeNull();
  });

  it("tracks the active job after beginJob and clears it after endJob for the SAME jobId", () => {
    const registry = new JobExecutionRegistry();
    registry.beginJob({ jobId: "job-1", operation: "INSPECT_SCENE_EVIDENCE" });
    expect(registry.hasActiveJob()).toBe(true);
    expect(registry.getActiveJob()).toEqual({ jobId: "job-1", operation: "INSPECT_SCENE_EVIDENCE" });

    registry.endJob("job-1");
    expect(registry.hasActiveJob()).toBe(false);
  });

  it("endJob is a no-op for a jobId that is not the currently active one (defensive)", () => {
    const registry = new JobExecutionRegistry();
    registry.beginJob({ jobId: "job-1", operation: "INSPECT_SCENE_EVIDENCE" });
    registry.endJob("some-other-job");
    expect(registry.hasActiveJob()).toBe(true);
  });

  it("abortActiveJob terminates every registered owner and returns their outcomes", async () => {
    const registry = new JobExecutionRegistry();
    registry.beginJob({ jobId: "job-1", operation: "INSPECT_SCENE_EVIDENCE" });
    const ownerA = fakeOwner({ outcome: "terminated", pid: 111, reason: "x", durationMs: 1 });
    const ownerB = fakeOwner({ outcome: "terminated", pid: 222, reason: "x", durationMs: 1 });
    registry.registerMcpOwner(ownerA);
    registry.registerMcpOwner(ownerB);

    const outcomes = await registry.abortActiveJob("test abort");

    expect(ownerA.terminate).toHaveBeenCalledWith("test abort");
    expect(ownerB.terminate).toHaveBeenCalledWith("test abort");
    expect(outcomes).toHaveLength(2);
    expect(outcomes.map((o) => o.pid).sort()).toEqual([111, 222]);
  });

  it("P5 test 4: never terminates an owner that was unregistered before abort, or one that never registered at all", async () => {
    const registry = new JobExecutionRegistry();
    registry.beginJob({ jobId: "job-1", operation: "INSPECT_SCENE_EVIDENCE" });
    const stillOwned = fakeOwner({ outcome: "terminated", pid: 1, reason: "x", durationMs: 1 });
    const unregisteredBeforeAbort = fakeOwner({ outcome: "terminated", pid: 2, reason: "x", durationMs: 1 });
    const neverRegistered = fakeOwner({ outcome: "terminated", pid: 3, reason: "x", durationMs: 1 });

    registry.registerMcpOwner(stillOwned);
    const unregister = registry.registerMcpOwner(unregisteredBeforeAbort);
    unregister();

    await registry.abortActiveJob("test abort");

    expect(stillOwned.terminate).toHaveBeenCalledTimes(1);
    expect(unregisteredBeforeAbort.terminate).not.toHaveBeenCalled();
    expect(neverRegistered.terminate).not.toHaveBeenCalled();
  });

  it("abortActiveJob with no registered owners returns an empty array and never throws", async () => {
    const registry = new JobExecutionRegistry();
    registry.beginJob({ jobId: "job-1", operation: "CHECK_HEALTH" });
    await expect(registry.abortActiveJob("no owners")).resolves.toEqual([]);
  });

  it("beginJob for a new job resets the owner set from a previous job", async () => {
    const registry = new JobExecutionRegistry();
    registry.beginJob({ jobId: "job-1", operation: "INSPECT_SCENE_EVIDENCE" });
    const staleOwner = fakeOwner({ outcome: "terminated", pid: 1, reason: "x", durationMs: 1 });
    registry.registerMcpOwner(staleOwner);
    registry.endJob("job-1");

    registry.beginJob({ jobId: "job-2", operation: "INSPECT_SCENE_EVIDENCE" });
    await registry.abortActiveJob("job-2 abort");

    expect(staleOwner.terminate).not.toHaveBeenCalled();
  });
});
