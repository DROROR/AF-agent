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

/**
 * Real production bug, 2026-08-30: two real generate-suggestions attempts
 * for a project needing AI help on most/all of its scenes never completed
 * within the ordinary 8-second REQUEST_TIMEOUT_MS this proxy route used to
 * carry - proven via dyo-api logs (neither request ever logged completion)
 * and a ~9-minute DB poll showing zero suggestions persisted. This route
 * must use the longer, dedicated GENERATE_SUGGESTIONS_TIMEOUT_MS instead.
 */
describe("mapping-suggestions/generate route - long-running-generation timeout", () => {
  it("proxies to the real backend POST /api/projects/:projectId/mapping-suggestions/generate", async () => {
    const fetchMock = stubFetch(200, { suggestions: [], aiAvailable: true, sceneEvidenceAvailability: {} });
    const response = await POST(new Request("http://x", { method: "POST" }), { params });

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/projects/11111111-1111-1111-1111-111111111111/mapping-suggestions/generate");
    expect(init.method).toBe("POST");
  });

  it("arms its abort timer at 180 seconds, not the normal 8 seconds - the whole point of this fix", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    stubFetch(200, { suggestions: [], aiAvailable: true, sceneEvidenceAvailability: {} });
    await POST(new Request("http://x", { method: "POST" }), { params });

    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(180_000);
    expect(delays).not.toContain(8_000);
  });

  it("relays a real successful generation response verbatim - unchanged behavior", async () => {
    const generated = { suggestions: [{ id: "s1", status: "PENDING" }], aiAvailable: true, sceneEvidenceAvailability: {} };
    stubFetch(200, generated);
    const response = await POST(new Request("http://x", { method: "POST" }), { params });

    const body = await response.json();
    expect(body).toEqual(generated);
  });

  it("forwards the session cookie as a bearer token, same auth as every other route - unchanged", async () => {
    getMockCookie.mockReturnValue({ value: "real-session-token" });
    const fetchMock = stubFetch(200, { suggestions: [], aiAvailable: true, sceneEvidenceAvailability: {} });
    await POST(new Request("http://x", { method: "POST" }), { params });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ authorization: "Bearer real-session-token" });
  });

  it("degrades to a 502 UPSTREAM_UNAVAILABLE, never an uncaught throw, if the backend never responds within 180 seconds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("aborted");
      })
    );
    const response = await POST(new Request("http://x", { method: "POST" }), { params });
    expect(response.status).toBe(502);
  });
});
