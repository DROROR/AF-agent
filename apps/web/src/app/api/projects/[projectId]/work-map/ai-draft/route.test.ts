// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const getMockCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: getMockCookie })
}));

import { POST } from "./route";

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

function requestWithInstructions(): Request {
  return new Request("http://x", { method: "POST", body: JSON.stringify({ instructions: "Use the login screen." }) });
}

/**
 * "Tell AI what you want" - video-planning UX simplification, 2026-08-31.
 * A real single Anthropic call, same longer, dedicated timeout as
 * mapping-suggestions/generate/route.ts - never the normal 8-second one.
 */
describe("work-map/ai-draft route - long-running AI draft timeout", () => {
  it("proxies to the real backend POST /api/projects/:projectId/work-map/ai-draft", async () => {
    const fetchMock = stubFetch(201, { workMap: { id: "wm-1", projectId: "x", revision: 1, entries: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } });
    const response = await POST(requestWithInstructions(), { params });

    expect(response.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/projects/11111111-1111-1111-1111-111111111111/work-map/ai-draft");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ instructions: "Use the login screen." }));
  });

  it("arms its abort timer at 180 seconds, not the normal 8 seconds", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    stubFetch(201, { workMap: null });
    await POST(requestWithInstructions(), { params });

    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(180_000);
    expect(delays).not.toContain(8_000);
  });

  it("forwards the session cookie as a bearer token, same auth as every other route", async () => {
    getMockCookie.mockReturnValue({ value: "real-session-token" });
    const fetchMock = stubFetch(201, { workMap: null });
    await POST(requestWithInstructions(), { params });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ authorization: "Bearer real-session-token" });
  });

  it("relays a real typed refusal (e.g. NO_USABLE_WORK_MAP_DRAFT) verbatim, never masking it as a generic failure", async () => {
    stubFetch(422, { error: { code: "NO_USABLE_WORK_MAP_DRAFT", message: "AI could not build a plan from that description.", requestId: "r1" } });
    const response = await POST(requestWithInstructions(), { params });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NO_USABLE_WORK_MAP_DRAFT");
  });

  it("degrades to a 502 UPSTREAM_UNAVAILABLE, never an uncaught throw, if the backend never responds within 180 seconds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("aborted");
      })
    );
    const response = await POST(requestWithInstructions(), { params });
    expect(response.status).toBe(502);
  });
});
