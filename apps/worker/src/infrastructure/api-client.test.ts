import { describe, expect, it, vi } from "vitest";
import { ApiResponseError, NetworkError, UnauthorizedApiError } from "../errors/worker-error.js";
import { ApiClient } from "./api-client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("ApiClient.registerWorker", () => {
  it("returns the parsed workerId/workerToken on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        workerId: "11111111-1111-1111-1111-111111111111",
        workerToken: "issued-token"
      })
    );
    const client = new ApiClient({ apiUrl: "https://api.example.com", fetchImpl });

    const result = await client.registerWorker("registration-secret", {
      name: "worker-a",
      maxConcurrency: 1,
      capabilities: ["CHECK_HEALTH"]
    });

    expect(result).toEqual({
      workerId: "11111111-1111-1111-1111-111111111111",
      workerToken: "issued-token"
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/workers/register");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer registration-secret"
    );
  });

  it("throws UnauthorizedApiError on a 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "UNAUTHORIZED" } }));
    const client = new ApiClient({ apiUrl: "https://api.example.com", fetchImpl });

    await expect(
      client.registerWorker("bad-secret", { name: "worker-a", maxConcurrency: 1, capabilities: [] })
    ).rejects.toThrow(UnauthorizedApiError);
  });

  it("throws ApiResponseError on an unexpected status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: { code: "INTERNAL_ERROR" } }));
    const client = new ApiClient({ apiUrl: "https://api.example.com", fetchImpl });

    await expect(
      client.registerWorker("secret", { name: "worker-a", maxConcurrency: 1, capabilities: [] })
    ).rejects.toThrow(ApiResponseError);
  });

  it("throws NetworkError when the request itself fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new ApiClient({ apiUrl: "https://api.example.com", fetchImpl });

    await expect(
      client.registerWorker("secret", { name: "worker-a", maxConcurrency: 1, capabilities: [] })
    ).rejects.toThrow(NetworkError);
  });
});

describe("ApiClient.sendHeartbeat", () => {
  const heartbeatBody = {
    aeStatus: "UNKNOWN" as const,
    mcpStatus: "UNKNOWN" as const,
    aeVersion: null,
    currentJobId: null
  };

  it("returns the parsed worker DTO on success", async () => {
    const dto = {
      workerId: "11111111-1111-1111-1111-111111111111",
      name: "worker-a",
      status: "ONLINE" as const,
      lastHeartbeatAt: new Date().toISOString(),
      aeStatus: "UNKNOWN" as const,
      mcpStatus: "UNKNOWN" as const,
      aeVersion: null,
      capabilities: ["CHECK_HEALTH"] as const,
      maxConcurrency: 1,
      currentJobId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, dto));
    const client = new ApiClient({ apiUrl: "https://api.example.com", fetchImpl });

    const result = await client.sendHeartbeat(
      "11111111-1111-1111-1111-111111111111",
      "worker-token",
      heartbeatBody
    );
    expect(result.workerId).toBe("11111111-1111-1111-1111-111111111111");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.example.com/api/workers/11111111-1111-1111-1111-111111111111/heartbeat"
    );
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer worker-token");
  });

  it("throws UnauthorizedApiError when the worker token is rejected", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "UNAUTHORIZED" } }));
    const client = new ApiClient({ apiUrl: "https://api.example.com", fetchImpl });

    await expect(
      client.sendHeartbeat("11111111-1111-1111-1111-111111111111", "wrong-token", heartbeatBody)
    ).rejects.toThrow(UnauthorizedApiError);
  });
});
