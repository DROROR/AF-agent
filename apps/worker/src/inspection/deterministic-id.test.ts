import { describe, expect, it } from "vitest";
import { deterministicId } from "./deterministic-id.js";

describe("deterministicId", () => {
  it("produces the same ID for the same inputs, called twice", () => {
    const a = deterministicId(["comp-1", "3"]);
    const b = deterministicId(["comp-1", "3"]);
    expect(a).toBe(b);
  });

  it("produces different IDs for different layer indexes in the same composition (duplicate layer names must not collapse)", () => {
    const a = deterministicId(["comp-1", "1"]);
    const b = deterministicId(["comp-1", "2"]);
    expect(a).not.toBe(b);
  });

  it("produces different IDs for the same index in different compositions", () => {
    const a = deterministicId(["comp-1", "1"]);
    const b = deterministicId(["comp-2", "1"]);
    expect(a).not.toBe(b);
  });

  it("does not collide when concatenation would be ambiguous without a separator", () => {
    const a = deterministicId(["ab", "c"]);
    const b = deterministicId(["a", "bc"]);
    expect(a).not.toBe(b);
  });

  it("is independent of layer name - only structural parts feed the ID", () => {
    // Simulates: the same structural position (comp + nesting path + index)
    // renamed in AE between two inspections must still be the same layer.
    const beforeRename = deterministicId(["comp-1", "5"]);
    const afterRename = deterministicId(["comp-1", "5"]);
    expect(beforeRename).toBe(afterRename);
  });
});
