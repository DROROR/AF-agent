import { describe, expect, it } from "vitest";
import { assertManagedRuntime, UnmanagedProductionStartError } from "./production-runtime-guard.js";

function env(overrides: { NODE_ENV?: "development" | "production" | "test"; ALLOW_UNMANAGED_PRODUCTION_START?: boolean } = {}) {
  return { NODE_ENV: "development" as const, ALLOW_UNMANAGED_PRODUCTION_START: false, ...overrides };
}

describe("assertManagedRuntime", () => {
  it("never blocks a non-production environment, PM2 or not (npm run dev, tests)", () => {
    expect(() => assertManagedRuntime(env({ NODE_ENV: "development" }), undefined)).not.toThrow();
    expect(() => assertManagedRuntime(env({ NODE_ENV: "test" }), undefined)).not.toThrow();
  });

  it("allows a production launch when PM2's own pm_id marker is present, regardless of its value", () => {
    expect(() => assertManagedRuntime(env({ NODE_ENV: "production" }), "0")).not.toThrow();
    expect(() => assertManagedRuntime(env({ NODE_ENV: "production" }), "")).not.toThrow();
  });

  it("refuses a production launch with no PM2 marker and no explicit opt-in - the exact 2026-08-26 incident shape", () => {
    expect(() => assertManagedRuntime(env({ NODE_ENV: "production" }), undefined)).toThrow(UnmanagedProductionStartError);
  });

  it("allows a production launch with no PM2 marker only when ALLOW_UNMANAGED_PRODUCTION_START is explicitly set", () => {
    expect(() =>
      assertManagedRuntime(env({ NODE_ENV: "production", ALLOW_UNMANAGED_PRODUCTION_START: true }), undefined)
    ).not.toThrow();
  });

  it("never trusts NODE_ENV=production alone as proof of a legitimate launch - the escape hatch must be explicit", () => {
    // Someone could set NODE_ENV=production by hand just as easily as they set pm_id -
    // this guard's real authority is the PM2 marker or the explicit opt-in, never NODE_ENV by itself.
    expect(() =>
      assertManagedRuntime(env({ NODE_ENV: "production", ALLOW_UNMANAGED_PRODUCTION_START: false }), undefined)
    ).toThrow(/ALLOW_UNMANAGED_PRODUCTION_START/);
  });
});
