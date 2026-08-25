import { describe, expect, it } from "vitest";
import {
  AE_STATUSES,
  JOB_STATUSES,
  MCP_STATUSES,
  USER_ROLES,
  WORKER_CAPABILITIES,
  WORKER_STATUSES
} from "@dyo/schemas";
import {
  DB_AE_STATUSES,
  DB_JOB_STATUSES,
  DB_MCP_STATUSES,
  DB_USER_ROLES,
  DB_WORKER_CAPABILITIES,
  DB_WORKER_STATUSES
} from "./schema.js";

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

  it("worker capabilities (job operation allowlist) match", () => {
    expect(DB_WORKER_CAPABILITIES).toEqual(WORKER_CAPABILITIES);
  });

  it("job statuses match", () => {
    expect(DB_JOB_STATUSES).toEqual(JOB_STATUSES);
  });

  it("user roles match", () => {
    expect(DB_USER_ROLES).toEqual(USER_ROLES);
  });
});
