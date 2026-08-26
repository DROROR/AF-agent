// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const getMockCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: getMockCookie })
}));

import { proxyToApi } from "./api-proxy";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  getMockCookie.mockReset();
});

function stubFetch(status: number, body: unknown | null): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    status,
    text: async () => (body === null ? "" : JSON.stringify(body))
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("proxyToApi", () => {
  it("never sends a content-type header on a bodyless request (GET/DELETE) - Fastify's JSON parser rejects an empty body carrying that header", async () => {
    const fetchMock = stubFetch(204, null);
    await proxyToApi("/api/projects/x/assets/y", { method: "DELETE" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("content-type");
    expect(init.body).toBeUndefined();
  });

  it("sends content-type: application/json only when a real body is present", async () => {
    const fetchMock = stubFetch(200, { ok: true });
    await proxyToApi("/api/projects/x/execution-plan", { method: "PATCH", body: { baseRevision: 1, operations: [] } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ baseRevision: 1, operations: [] }));
  });

  it("relays a real 204 as a genuinely empty response, never JSON-encoding a null body", async () => {
    stubFetch(204, null);
    const response = await proxyToApi("/api/projects/x/assets/y", { method: "DELETE" });
    expect(response.status).toBe(204);
    const text = await response.text();
    expect(text).toBe("");
  });

  it("forwards the session cookie as a bearer token when present", async () => {
    getMockCookie.mockReturnValue({ value: "real-session-token" });
    const fetchMock = stubFetch(200, { ok: true });
    await proxyToApi("/api/projects", { method: "GET" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ authorization: "Bearer real-session-token" });
  });

  it("degrades to a 502 UPSTREAM_UNAVAILABLE, never an uncaught throw, when the control-plane API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      })
    );
    const response = await proxyToApi("/api/projects", { method: "GET" });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});
