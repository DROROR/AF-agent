import { describe, expect, it, vi } from "vitest";
import { fetchDashboardStatus } from "./fetch-dashboard-status";

const validWorkerDto = {
  workerId: "11111111-1111-1111-1111-111111111111",
  name: "worker-a",
  status: "ONLINE",
  lastHeartbeatAt: new Date().toISOString(),
  aeStatus: "ONLINE",
  mcpStatus: "UNKNOWN",
  aeAvailability: "ONLINE",
  mcpAvailability: "UNKNOWN",
  aeVersion: "2026",
  capabilities: ["CHECK_HEALTH"],
  maxConcurrency: 1,
  currentJobId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

function jsonResponse(ok: boolean, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { "content-type": "application/json" }
  });
}

function fetchRouter(routes: Record<string, Response>): typeof fetch {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    for (const [path, response] of Object.entries(routes)) {
      if (url.endsWith(path)) {
        return Promise.resolve(response);
      }
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
}

describe("fetchDashboardStatus", () => {
  it("returns ok/ok and the parsed worker list when everything is healthy", async () => {
    const fetchImpl = fetchRouter({
      "/health/live": jsonResponse(true, { status: "ok" }),
      "/health/ready": jsonResponse(true, { status: "ok", database: "ok" }),
      "/api/workers": jsonResponse(true, { workers: [validWorkerDto] })
    });

    const status = await fetchDashboardStatus("http://127.0.0.1:4000", fetchImpl);

    expect(status.api).toBe("ok");
    expect(status.database).toBe("ok");
    expect(status.workers).toHaveLength(1);
    expect(status.workers?.[0]?.workerId).toBe(validWorkerDto.workerId);
  });

  it("reports database error without touching workers when readiness fails", async () => {
    const fetchImpl = fetchRouter({
      "/health/live": jsonResponse(true, { status: "ok" }),
      "/health/ready": jsonResponse(false, { error: { code: "INTERNAL_ERROR" } }),
      "/api/workers": jsonResponse(true, { workers: [validWorkerDto] })
    });

    const status = await fetchDashboardStatus("http://127.0.0.1:4000", fetchImpl);

    expect(status.api).toBe("ok");
    expect(status.database).toBe("error");
    expect(status.workers).toHaveLength(1);
  });

  it("reports api error and unknown database when the API is unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const status = await fetchDashboardStatus("http://127.0.0.1:4000", fetchImpl);

    expect(status.api).toBe("error");
    expect(status.database).toBe("unknown");
    expect(status.workers).toBeNull();
  });

  it("degrades to workers: null rather than throwing when the response no longer matches the shared schema", async () => {
    const fetchImpl = fetchRouter({
      "/health/live": jsonResponse(true, { status: "ok" }),
      "/health/ready": jsonResponse(true, { status: "ok", database: "ok" }),
      "/api/workers": jsonResponse(true, { workers: [{ unexpected: "shape" }] })
    });

    const status = await fetchDashboardStatus("http://127.0.0.1:4000", fetchImpl);

    expect(status.api).toBe("ok");
    expect(status.workers).toBeNull();
  });

  it("degrades to workers: null when the workers endpoint returns invalid JSON", async () => {
    const fetchImpl = fetchRouter({
      "/health/live": jsonResponse(true, { status: "ok" }),
      "/health/ready": jsonResponse(true, { status: "ok", database: "ok" }),
      "/api/workers": new Response("not json", { status: 200 })
    });

    const status = await fetchDashboardStatus("http://127.0.0.1:4000", fetchImpl);

    expect(status.workers).toBeNull();
  });
});
