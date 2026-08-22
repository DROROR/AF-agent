import { describe, expect, it } from "vitest";
import { nextBackoffDelayMs } from "./backoff.js";

const policy = { baseMs: 1000, maxMs: 30_000 };

describe("nextBackoffDelayMs", () => {
  it("returns the base delay on the first failure", () => {
    expect(nextBackoffDelayMs(1, policy)).toBe(1000);
  });

  it("doubles on each subsequent failure", () => {
    expect(nextBackoffDelayMs(2, policy)).toBe(2000);
    expect(nextBackoffDelayMs(3, policy)).toBe(4000);
    expect(nextBackoffDelayMs(4, policy)).toBe(8000);
  });

  it("never exceeds maxMs no matter how many failures", () => {
    expect(nextBackoffDelayMs(10, policy)).toBe(30_000);
    expect(nextBackoffDelayMs(1000, policy)).toBe(30_000);
  });

  it("rejects a non-positive failure count", () => {
    expect(() => nextBackoffDelayMs(0, policy)).toThrow(RangeError);
    expect(() => nextBackoffDelayMs(-1, policy)).toThrow(RangeError);
  });
});
