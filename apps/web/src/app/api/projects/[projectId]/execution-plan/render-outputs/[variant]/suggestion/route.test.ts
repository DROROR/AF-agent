// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const getMockCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: getMockCookie })
}));

import { GET } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  getMockCookie.mockReset();
});

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const params = Promise.resolve({ projectId: PROJECT_ID, variant: "LANDSCAPE" });

function stubApi(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === "content-type" ? "application/json" : null) },
    text: async () => JSON.stringify(body),
    json: async () => body
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * 2026-10-04: the render-output suggestion is how a client avoids typing two
 * After Effects template names. The proxy must ask the real API for exactly
 * this project and output, as a read, and hand back what it said.
 */
describe("GET .../render-outputs/:variant/suggestion proxy", () => {
  it("asks the real API for this project's and this output's suggestion, as a GET", async () => {
    getMockCookie.mockReturnValue({ value: "token" });
    const fetchMock = stubApi(200, { suggestion: null });

    const response = await GET(new Request("http://x/api/whatever"), { params });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(String(url).endsWith(`/api/projects/${PROJECT_ID}/execution-plan/render-outputs/LANDSCAPE/suggestion`)).toBe(true);
    expect(init?.method ?? "GET").toBe("GET");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ suggestion: null });
  });

  it("forwards the caller's own session, and relays a refusal from the real API as that same status", async () => {
    getMockCookie.mockReturnValue({ value: "token" });
    const fetchMock = stubApi(404, { error: { code: "PROJECT_NOT_FOUND", message: "none", requestId: "r1" } });

    const response = await GET(new Request("http://x/api/whatever"), { params });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers["authorization"]).toBe("Bearer token");
    expect(response.status).toBe(404);
  });
});
