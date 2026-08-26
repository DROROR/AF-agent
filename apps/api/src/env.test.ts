import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const BASE = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  WORKER_REGISTRATION_SECRET: "a".repeat(16)
};

describe("loadEnv - NODE_ENV / ALLOW_UNMANAGED_PRODUCTION_START", () => {
  it("defaults NODE_ENV to development and ALLOW_UNMANAGED_PRODUCTION_START to false", () => {
    const env = loadEnv(BASE);
    expect(env.NODE_ENV).toBe("development");
    expect(env.ALLOW_UNMANAGED_PRODUCTION_START).toBe(false);
  });

  it("accepts NODE_ENV=production", () => {
    expect(loadEnv({ ...BASE, NODE_ENV: "production" }).NODE_ENV).toBe("production");
  });

  it("rejects an invalid NODE_ENV value", () => {
    expect(() => loadEnv({ ...BASE, NODE_ENV: "staging" })).toThrow();
  });

  it("only treats the literal strings '1' or 'true' as opting in - never a generic truthy-string coercion", () => {
    expect(loadEnv({ ...BASE, ALLOW_UNMANAGED_PRODUCTION_START: "1" }).ALLOW_UNMANAGED_PRODUCTION_START).toBe(true);
    expect(loadEnv({ ...BASE, ALLOW_UNMANAGED_PRODUCTION_START: "true" }).ALLOW_UNMANAGED_PRODUCTION_START).toBe(true);
    expect(loadEnv({ ...BASE, ALLOW_UNMANAGED_PRODUCTION_START: "false" }).ALLOW_UNMANAGED_PRODUCTION_START).toBe(false);
    expect(loadEnv({ ...BASE, ALLOW_UNMANAGED_PRODUCTION_START: "0" }).ALLOW_UNMANAGED_PRODUCTION_START).toBe(false);
    expect(loadEnv({ ...BASE, ALLOW_UNMANAGED_PRODUCTION_START: "yes" }).ALLOW_UNMANAGED_PRODUCTION_START).toBe(false);
  });
});
