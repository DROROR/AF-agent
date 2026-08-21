import { describe, expect, it } from "vitest";
import { AE_STATUSES, MCP_STATUSES, WORKER_STATUSES } from "@dyo/schemas";
import { DB_AE_STATUSES, DB_MCP_STATUSES, DB_WORKER_STATUSES } from "./schema.js";

// schema.ts cannot import these arrays at runtime from @dyo/schemas (see the
// comment there for why) so it re-declares them for the CHECK constraints.
// This test is the automated guard that keeps the two declarations honest.
describe("schema CHECK-constraint value lists stay in sync with @dyo/schemas", () => {
  it("worker statuses match", () => {
    expect(DB_WORKER_STATUSES).toEqual(WORKER_STATUSES);
  });

  it("AE statuses match", () => {
    expect(DB_AE_STATUSES).toEqual(AE_STATUSES);
  });

  it("MCP statuses match", () => {
    expect(DB_MCP_STATUSES).toEqual(MCP_STATUSES);
  });
});
