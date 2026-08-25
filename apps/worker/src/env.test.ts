import { describe, expect, it } from "vitest";
import { ConfigError } from "./errors/worker-error.js";
import { loadWorkerEnv } from "./env.js";

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    DYO_API_URL: "https://api.example.com",
    WORKER_NAME: "worker-a",
    ...overrides
  } as NodeJS.ProcessEnv;
}

describe("loadWorkerEnv", () => {
  it("loads valid environment with defaults applied", () => {
    const env = loadWorkerEnv(baseEnv());
    expect(env.apiUrl).toBe("https://api.example.com");
    expect(env.workerName).toBe("worker-a");
    expect(env.heartbeatIntervalMs).toBe(15_000);
    expect(env.workRoot.length).toBeGreaterThan(0);
  });

  it("strips a trailing slash from DYO_API_URL", () => {
    const env = loadWorkerEnv(baseEnv({ DYO_API_URL: "https://api.example.com/" }));
    expect(env.apiUrl).toBe("https://api.example.com");
  });

  it("rejects a missing DYO_API_URL", () => {
    const env = baseEnv();
    delete (env as Record<string, string | undefined>).DYO_API_URL;
    expect(() => loadWorkerEnv(env)).toThrow(ConfigError);
  });

  it("rejects an invalid DYO_API_URL", () => {
    expect(() => loadWorkerEnv(baseEnv({ DYO_API_URL: "not-a-url" }))).toThrow(ConfigError);
  });

  it("accepts WORKER_ID and WORKER_TOKEN set together", () => {
    const env = loadWorkerEnv(
      baseEnv({
        WORKER_ID: "11111111-1111-1111-1111-111111111111",
        WORKER_TOKEN: "some-token"
      })
    );
    expect(env.workerId).toBe("11111111-1111-1111-1111-111111111111");
    expect(env.workerToken).toBe("some-token");
  });

  it("rejects WORKER_ID set without WORKER_TOKEN", () => {
    expect(() =>
      loadWorkerEnv(baseEnv({ WORKER_ID: "11111111-1111-1111-1111-111111111111" }))
    ).toThrow(ConfigError);
  });

  it("rejects WORKER_TOKEN set without WORKER_ID", () => {
    expect(() => loadWorkerEnv(baseEnv({ WORKER_TOKEN: "some-token" }))).toThrow(ConfigError);
  });

  it("respects an explicit WORK_ROOT", () => {
    const env = loadWorkerEnv(baseEnv({ WORK_ROOT: "/custom/work-root" }));
    expect(env.workRoot).toBe("/custom/work-root");
  });

  it("coerces HEARTBEAT_INTERVAL_MS to a positive integer", () => {
    const env = loadWorkerEnv(baseEnv({ HEARTBEAT_INTERVAL_MS: "5000" }));
    expect(env.heartbeatIntervalMs).toBe(5000);
  });

  it("rejects a non-positive HEARTBEAT_INTERVAL_MS", () => {
    expect(() => loadWorkerEnv(baseEnv({ HEARTBEAT_INTERVAL_MS: "0" }))).toThrow(ConfigError);
  });

  it("never appears to accept a short WORKER_REGISTRATION_SECRET", () => {
    expect(() =>
      loadWorkerEnv(baseEnv({ WORKER_REGISTRATION_SECRET: "too-short" }))
    ).toThrow(ConfigError);
  });

  it("leaves AE_MCP_PATH undefined when not set", () => {
    const env = loadWorkerEnv(baseEnv());
    expect(env.aeMcpPath).toBeUndefined();
  });

  it("passes through an explicit AE_MCP_PATH - the fixed base for the real ae-mcp CLI/MCP-server entry point", () => {
    const env = loadWorkerEnv(baseEnv({ AE_MCP_PATH: "C:\\AI-Tools\\ae-mcp" }));
    expect(env.aeMcpPath).toBe("C:\\AI-Tools\\ae-mcp");
  });
});
