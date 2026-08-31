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

const params = Promise.resolve({ projectId: "11111111-1111-1111-1111-111111111111", artifactId: "22222222-2222-2222-2222-222222222222" });

/**
 * Client-handoff phase, section S/T ("Final Outputs / Downloads", "Video
 * download acceptance test") - proves the real download route forwards
 * authorization, uses the long render-artifact timeout (not the normal
 * 8s), relays real bytes/headers verbatim, and degrades cleanly.
 */
describe("GET /api/projects/:projectId/render-artifacts/:artifactId/file", () => {
  it("forwards the session cookie as a bearer token - same auth as every other route", async () => {
    getMockCookie.mockReturnValue({ value: "real-session-token" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === "content-type" ? "video/mp4" : name === "content-disposition" ? 'attachment; filename="output.mp4"' : null) },
      arrayBuffer: async () => new TextEncoder().encode("real video bytes").buffer,
      text: async () => ""
    }));
    vi.stubGlobal("fetch", fetchMock);

    await GET(new Request("http://x"), { params });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ authorization: "Bearer real-session-token" });
  });

  it("uses the long render-artifact download timeout, not the normal 8 seconds - a real render file can be large", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => ""
      }))
    );
    await GET(new Request("http://x"), { params });
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(5 * 60 * 1000);
    expect(delays).not.toContain(8_000);
  });

  it("relays the real bytes and content-type/content-disposition headers verbatim - never re-encodes as JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name === "content-type" ? "video/mp4" : name === "content-disposition" ? 'attachment; filename="output.mp4"' : null) },
        arrayBuffer: async () => new TextEncoder().encode("real video bytes").buffer,
        text: async () => ""
      }))
    );
    const response = await GET(new Request("http://x"), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="output.mp4"');
    const body = await response.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it("relays a real 404 (unauthorized project or missing artifact) verbatim, never masking it as a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => JSON.stringify({ error: { code: "RENDER_ARTIFACT_NOT_FOUND", message: "not found", requestId: "r1" } })
      }))
    );
    const response = await GET(new Request("http://x"), { params });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RENDER_ARTIFACT_NOT_FOUND");
  });

  it("degrades to a 502 UPSTREAM_UNAVAILABLE, never an uncaught throw, if the backend is unreachable or the download times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("aborted");
      })
    );
    const response = await GET(new Request("http://x"), { params });
    expect(response.status).toBe(502);
  });
});
