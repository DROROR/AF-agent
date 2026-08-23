import { describe, expect, it } from "vitest";
import { canClaimAnotherJob, isJobTerminal, isValidJobStatusTransition } from "./rules.js";

describe("isJobTerminal", () => {
  it("treats SUCCEEDED/FAILED/CANCELLED as terminal", () => {
    expect(isJobTerminal("SUCCEEDED")).toBe(true);
    expect(isJobTerminal("FAILED")).toBe(true);
    expect(isJobTerminal("CANCELLED")).toBe(true);
  });

  it("treats QUEUED/CLAIMED/RUNNING/WAITING_FOR_ACTION as non-terminal", () => {
    expect(isJobTerminal("QUEUED")).toBe(false);
    expect(isJobTerminal("CLAIMED")).toBe(false);
    expect(isJobTerminal("RUNNING")).toBe(false);
    expect(isJobTerminal("WAITING_FOR_ACTION")).toBe(false);
  });
});

describe("isValidJobStatusTransition", () => {
  it("allows QUEUED -> CLAIMED", () => {
    expect(isValidJobStatusTransition("QUEUED", "CLAIMED")).toBe(true);
  });

  it("allows CLAIMED -> RUNNING", () => {
    expect(isValidJobStatusTransition("CLAIMED", "RUNNING")).toBe(true);
  });

  it("allows RUNNING -> SUCCEEDED and RUNNING -> FAILED", () => {
    expect(isValidJobStatusTransition("RUNNING", "SUCCEEDED")).toBe(true);
    expect(isValidJobStatusTransition("RUNNING", "FAILED")).toBe(true);
  });

  it("rejects a completed job accepting any further transition", () => {
    expect(isValidJobStatusTransition("SUCCEEDED", "RUNNING")).toBe(false);
    expect(isValidJobStatusTransition("FAILED", "QUEUED")).toBe(false);
    expect(isValidJobStatusTransition("CANCELLED", "CLAIMED")).toBe(false);
  });

  it("rejects skipping straight from QUEUED to SUCCEEDED", () => {
    expect(isValidJobStatusTransition("QUEUED", "SUCCEEDED")).toBe(false);
  });

  it("rejects a transition to the same status (no-op is not a transition)", () => {
    expect(isValidJobStatusTransition("RUNNING", "RUNNING")).toBe(false);
  });
});

describe("canClaimAnotherJob", () => {
  it("allows claiming when active count is below maxConcurrency", () => {
    expect(canClaimAnotherJob(0, 1)).toBe(true);
  });

  it("refuses claiming when active count already equals maxConcurrency (maxConcurrency=1 case)", () => {
    expect(canClaimAnotherJob(1, 1)).toBe(false);
  });

  it("refuses claiming when active count exceeds maxConcurrency", () => {
    expect(canClaimAnotherJob(2, 1)).toBe(false);
  });
});
