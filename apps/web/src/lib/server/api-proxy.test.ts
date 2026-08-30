// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const getMockCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: getMockCookie })
}));

import { proxyBinaryDownload, proxyMultipartUpload, proxyToApi } from "./api-proxy";

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

  it("arms its abort timer at the normal 8 seconds, never the longer upload timeout", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    stubFetch(200, { ok: true });
    await proxyToApi("/api/projects", { method: "GET" });
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(8_000);
    expect(delays).not.toContain(10 * 60 * 1000);
  });

  it("still arms its abort timer at the normal 8 seconds when no timeoutMs override is given - every existing caller is unaffected by the new optional parameter", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    stubFetch(200, { ok: true });
    await proxyToApi("/api/projects/x/execution-plan", { method: "PATCH", body: { baseRevision: 1, operations: [] } });
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(8_000);
  });

  it("real production bug, 2026-08-30: honors an explicit timeoutMs override for a real long-running call (mapping-suggestions/generate) instead of the normal 8 seconds", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    stubFetch(200, { suggestions: [], aiAvailable: true, sceneEvidenceAvailability: {} });
    await proxyToApi("/api/projects/x/mapping-suggestions/generate", { method: "POST", timeoutMs: 180_000 });
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(180_000);
    expect(delays).not.toContain(8_000);
  });
});

describe("proxyMultipartUpload - upload-specific timeout (proven fix for real MP4 upload failures)", () => {
  function multipartRequest(): Request {
    return new Request("http://x/api/projects/x/assets", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=real-boundary" },
      body: "real-file-bytes"
    });
  }

  it("arms its abort timer at the longer (10 minute) upload timeout, not the normal 8 seconds", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    stubFetch(201, { asset: { id: "asset-1" } });
    await proxyMultipartUpload("/api/projects/x/assets", multipartRequest());
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(10 * 60 * 1000);
    expect(delays).not.toContain(8_000);
  });

  it("forwards the real multipart content-type (with boundary) and the raw body bytes verbatim - unchanged behavior", async () => {
    const fetchMock = stubFetch(201, { asset: { id: "asset-1" } });
    await proxyMultipartUpload("/api/projects/x/assets", multipartRequest());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ "content-type": "multipart/form-data; boundary=real-boundary" });
  });

  it("relays a real successful upload response verbatim - unchanged behavior", async () => {
    stubFetch(201, { asset: { id: "asset-1", mediaKind: "VIDEO" } });
    const response = await proxyMultipartUpload("/api/projects/x/assets", multipartRequest());
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.asset.mediaKind).toBe("VIDEO");
  });

  it("degrades to a 502 UPSTREAM_UNAVAILABLE, never an uncaught throw, when the upload times out or the API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      })
    );
    const response = await proxyMultipartUpload("/api/projects/x/assets", multipartRequest());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});

describe("proxyBinaryDownload - unrelated to the upload timeout fix, unchanged", () => {
  it("still arms its abort timer at the normal 8 seconds, never the upload timeout", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name === "content-type" ? "video/mp4" : null) },
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => ""
      }))
    );
    await proxyBinaryDownload("/api/projects/x/assets/y/file");
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(8_000);
    expect(delays).not.toContain(10 * 60 * 1000);
  });
});
