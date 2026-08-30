import { describe, expect, it } from "vitest";
import { BASE_BACKOFF_MS, MAX_BACKOFF_MS, computeBackoffMs, decideRestart } from "./restart-policy.js";

describe("computeBackoffMs", () => {
  it("starts at BASE_BACKOFF_MS for the first attempt (restartCount 0)", () => {
    expect(computeBackoffMs(0)).toBe(BASE_BACKOFF_MS);
  });

  it("doubles per attempt", () => {
    expect(computeBackoffMs(1)).toBe(BASE_BACKOFF_MS * 2);
    expect(computeBackoffMs(2)).toBe(BASE_BACKOFF_MS * 4);
  });

  it("is capped at MAX_BACKOFF_MS and never grows unbounded", () => {
    expect(computeBackoffMs(10)).toBe(MAX_BACKOFF_MS);
    expect(computeBackoffMs(1000)).toBe(MAX_BACKOFF_MS);
  });

  it("treats a negative restartCount as attempt 0 rather than throwing or going negative", () => {
    expect(computeBackoffMs(-5)).toBe(BASE_BACKOFF_MS);
  });

  it("is deterministic - same input always produces the same output, no randomness", () => {
    expect(computeBackoffMs(3)).toBe(computeBackoffMs(3));
  });
});

describe("decideRestart", () => {
  it("never restarts while maintenance is active, regardless of restartCount", () => {
    const decision = decideRestart({ maintenanceActive: true, restartCount: 0 });
    expect(decision.shouldRestart).toBe(false);
    expect(decision.backoffMs).toBe(0);
    expect(decision.reason).toMatch(/maintenance/i);
  });

  it("restarts with the computed backoff when maintenance is not active", () => {
    const decision = decideRestart({ maintenanceActive: false, restartCount: 2 });
    expect(decision.shouldRestart).toBe(true);
    expect(decision.backoffMs).toBe(computeBackoffMs(2));
  });

  it("maintenance always wins even with a high restart count", () => {
    const decision = decideRestart({ maintenanceActive: true, restartCount: 50 });
    expect(decision.shouldRestart).toBe(false);
  });
});
