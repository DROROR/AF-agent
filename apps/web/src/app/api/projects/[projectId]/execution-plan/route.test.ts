// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const getMockCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: getMockCookie })
}));

import { GET, PATCH, POST } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  getMockCookie.mockReset();
});

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ status, text: async () => JSON.stringify(body) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const params = Promise.resolve({ projectId: "11111111-1111-1111-1111-111111111111" });

/**
 * The client-level tests (projects-api-client.test.ts, ProjectScenesTab.test.tsx)
 * stub the browser's own global fetch, so they never actually invoke this
 * route's real handler function - only this file does. GET/PATCH's existing,
 * already-working behavior is included here as a baseline so a future change
 * to this route can never silently break them while "fixing" POST.
 */
describe("execution-plan route - GET/PATCH (existing, unchanged)", () => {
  it("GET proxies to the real backend route and forwards its response verbatim", async () => {
    const fetchMock = stubFetch(200, { plan: { status: "DRAFT" }, sceneTable: [] });
    const response = await GET(new Request("http://x/api/projects/x/execution-plan"), { params });

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/projects/11111111-1111-1111-1111-111111111111/execution-plan");
    expect(init.method).toBe("GET");
  });

  it("PATCH forwards the request body verbatim", async () => {
    const fetchMock = stubFetch(200, { plan: { status: "DRAFT" }, sceneTable: [] });
    const request = new Request("http://x", { method: "PATCH", body: JSON.stringify({ baseRevision: 1, operations: [] }) });
    await PATCH(request, { params });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ baseRevision: 1, operations: [] }));
  });
});

describe("execution-plan route - POST (real dashboard gap fix: creates the initial plan)", () => {
  it("proxies to the real backend POST /api/projects/:projectId/execution-plan", async () => {
    const fetchMock = stubFetch(201, { plan: { status: "DRAFT" }, sceneTable: [] });
    const response = await POST(new Request("http://x/api/projects/x/execution-plan", { method: "POST" }), { params });

    expect(response.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/projects/11111111-1111-1111-1111-111111111111/execution-plan");
    expect(init.method).toBe("POST");
  });

  it("relays the real created plan body verbatim (never reshaped)", async () => {
    const created = { plan: { id: "plan-1", status: "DRAFT", revision: 1 }, sceneTable: [] };
    stubFetch(201, created);
    const response = await POST(new Request("http://x", { method: "POST" }), { params });

    const body = (await response.json()) as typeof created;
    expect(body).toEqual(created);
  });

  it("relays a real 409 (a plan already exists) verbatim, never masking it as a generic failure", async () => {
    stubFetch(409, { error: { code: "CONFLICT", message: "an execution plan already exists", requestId: "r1" } });
    const response = await POST(new Request("http://x", { method: "POST" }), { params });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("forwards the session cookie as a bearer token, same auth as every other route", async () => {
    getMockCookie.mockReturnValue({ value: "real-session-token" });
    const fetchMock = stubFetch(201, { plan: { status: "DRAFT" }, sceneTable: [] });
    await POST(new Request("http://x", { method: "POST" }), { params });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ authorization: "Bearer real-session-token" });
  });

  it("never sends an empty content-type-less body that would trip Fastify's JSON parser - always a real {} body", async () => {
    const fetchMock = stubFetch(201, { plan: { status: "DRAFT" }, sceneTable: [] });
    await POST(new Request("http://x", { method: "POST" }), { params });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({}));
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
  });
});
