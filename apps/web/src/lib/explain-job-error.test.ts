import { describe, expect, it } from "vitest";
import { explainJobError } from "./explain-job-error";

describe("explainJobError", () => {
  it("recognises the real 2026-09-25 failure, exactly as the jobs table stored it", () => {
    // Copied in shape from the real recorded error - a stringified Zod
    // issue array, which is what a worker's strict payload schema produces.
    const stored = JSON.stringify([
      { code: "unrecognized_keys", keys: ["someFieldTheWorkerDoesNotKnow"], path: [], message: "Unrecognized key(s) in object" }
    ]);
    expect(explainJobError(stored)).toBe("WORKER_BEHIND_SERVER");
  });

  it("recognises the flattened prose form the worker's error path also produces", () => {
    expect(explainJobError('Unrecognized key(s) in object: "someField"')).toBe("WORKER_BEHIND_SERVER");
  });

  it("matches on the machine-readable code, not on any one field name", () => {
    // The point is the SHAPE of the failure. A future field nobody has
    // heard of must be explained just as well as the one that caused this.
    expect(explainJobError('[{"code":"unrecognized_keys","keys":["aFieldAddedNextYear"]}]')).toBe("WORKER_BEHIND_SERVER");
  });

  it("says nothing about the failures it cannot explain - silence, never a guess", () => {
    for (const unrelated of [
      "After Effects is holding unsaved changes in an untitled project - refusing to touch it",
      "TOOL_ERROR: [AE_NOT_CONNECTED] No live After Effects bridge heartbeat",
      "Template inspection could not produce a valid manifest.",
      'layer 6 is a 3D layer - cannot be safely adapted by 2D geometry rules',
      // A validation failure of a DIFFERENT kind is not this one.
      '[{"code":"invalid_type","expected":"string","received":"number"}]'
    ]) {
      expect(explainJobError(unrelated)).toBeNull();
    }
  });

  it("treats an absent or empty reason as nothing to explain", () => {
    expect(explainJobError(null)).toBeNull();
    expect(explainJobError(undefined)).toBeNull();
    expect(explainJobError("")).toBeNull();
    expect(explainJobError("   ")).toBeNull();
  });
});
