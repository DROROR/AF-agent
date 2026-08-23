import { describe, expect, it, vi } from "vitest";
import { resolveWorkerCredentials } from "./bootstrap.js";
import { ConfigError } from "./errors/worker-error.js";
import type { WorkerEnv } from "./env.js";
import type { ApiClient } from "./infrastructure/api-client.js";
import type { CredentialStore, WorkerCredentials } from "./infrastructure/credential-store.js";

function baseEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    apiUrl: "https://api.example.com",
    workerName: "worker-a",
    workerId: undefined,
    workerToken: undefined,
    workerRegistrationSecret: undefined,
    workRoot: "/tmp/dyo-agent",
    aePath: undefined,
    aerenderPath: undefined,
    aeMcpPath: undefined,
    aeMcpInstanceFilePath: undefined,
    heartbeatIntervalMs: 15_000,
    ...overrides
  };
}

function fakeStore(initial: WorkerCredentials | null = null): CredentialStore {
  let saved = initial;
  return {
    load: () => saved,
    save: (credentials: WorkerCredentials) => {
      saved = credentials;
    }
  } as unknown as CredentialStore;
}

const logger = { info: vi.fn() };

describe("resolveWorkerCredentials", () => {
  it("uses pre-provisioned WORKER_ID/WORKER_TOKEN without calling the API or the store", async () => {
    const env = baseEnv({
      workerId: "11111111-1111-1111-1111-111111111111",
      workerToken: "pre-provisioned-token"
    });
    const store = fakeStore();
    const apiClient = { registerWorker: vi.fn() } as unknown as ApiClient;

    const result = await resolveWorkerCredentials(env, store, apiClient, logger);

    expect(result).toEqual({
      workerId: "11111111-1111-1111-1111-111111111111",
      workerToken: "pre-provisioned-token"
    });
    expect(apiClient.registerWorker).not.toHaveBeenCalled();
  });

  it("uses previously persisted credentials without calling the API", async () => {
    const env = baseEnv();
    const store = fakeStore({
      workerId: "22222222-2222-2222-2222-222222222222",
      workerToken: "persisted-token"
    });
    const apiClient = { registerWorker: vi.fn() } as unknown as ApiClient;

    const result = await resolveWorkerCredentials(env, store, apiClient, logger);

    expect(result.workerId).toBe("22222222-2222-2222-2222-222222222222");
    expect(apiClient.registerWorker).not.toHaveBeenCalled();
  });

  it("registers with the API and persists the result when no credentials exist yet", async () => {
    const env = baseEnv({ workerRegistrationSecret: "a-very-long-registration-secret" });
    const store = fakeStore();
    const apiClient = {
      registerWorker: vi.fn().mockResolvedValue({
        workerId: "33333333-3333-3333-3333-333333333333",
        workerToken: "issued-token"
      })
    } as unknown as ApiClient;

    const result = await resolveWorkerCredentials(env, store, apiClient, logger);

    expect(apiClient.registerWorker).toHaveBeenCalledWith(
      "a-very-long-registration-secret",
      expect.objectContaining({ name: "worker-a", maxConcurrency: 1 })
    );
    expect(result).toEqual({
      workerId: "33333333-3333-3333-3333-333333333333",
      workerToken: "issued-token"
    });
    expect(store.load()).toEqual(result);
  });

  it("throws ConfigError when no credentials and no registration secret are available", async () => {
    const env = baseEnv();
    const store = fakeStore();
    const apiClient = { registerWorker: vi.fn() } as unknown as ApiClient;

    await expect(resolveWorkerCredentials(env, store, apiClient, logger)).rejects.toThrow(
      ConfigError
    );
    expect(apiClient.registerWorker).not.toHaveBeenCalled();
  });
});
