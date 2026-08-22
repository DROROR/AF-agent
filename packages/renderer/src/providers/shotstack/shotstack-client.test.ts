import { describe, expect, it, vi } from "vitest";
import { RendererNetworkError, RendererRequestError } from "../../errors.js";
import type { ShotstackEditPayload } from "./shotstack-payload.js";
import { ShotstackClient } from "./shotstack-client.js";

const config = {
  apiKey: "test-secret-key",
  baseUrl: "https://api.shotstack.io/edit/stage",
  env: "sandbox" as const
};

const minimalPayload: ShotstackEditPayload = {
  timeline: { background: "#000000", tracks: [] },
  output: { format: "mp4", size: { width: 1920, height: 1080 } }
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("ShotstackClient.createRender", () => {
  it("returns the render id on success and sends the api key as x-api-key", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { success: true, response: { id: "render-1" } }));
    const client = new ShotstackClient(config, fetchImpl as unknown as typeof fetch);

    const result = await client.createRender(minimalPayload);

    expect(result).toEqual({ id: "render-1" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.shotstack.io/edit/stage/render");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-secret-key");
  });

  it("throws RendererRequestError when the response no longer matches the documented shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: "shape" }));
    const client = new ShotstackClient(config, fetchImpl as unknown as typeof fetch);

    await expect(client.createRender(minimalPayload)).rejects.toThrow(RendererRequestError);
  });

  it("throws RendererRequestError on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { message: "Unauthorized" }));
    const client = new ShotstackClient(config, fetchImpl as unknown as typeof fetch);

    await expect(client.createRender(minimalPayload)).rejects.toThrow(RendererRequestError);
  });

  it("throws RendererNetworkError when the request itself fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new ShotstackClient(config, fetchImpl as unknown as typeof fetch);

    await expect(client.createRender(minimalPayload)).rejects.toThrow(RendererNetworkError);
  });

  it("never includes the api key in a thrown error's message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { message: "Unauthorized" }));
    const client = new ShotstackClient(config, fetchImpl as unknown as typeof fetch);

    try {
      await client.createRender(minimalPayload);
      expect.unreachable("expected createRender to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain(config.apiKey);
    }
  });
});

describe("ShotstackClient.getRenderStatus", () => {
  it("returns the parsed status/url/error fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        success: true,
        response: { id: "render-1", status: "done", url: "https://cdn.shotstack.io/out.mp4", error: null }
      })
    );
    const client = new ShotstackClient(config, fetchImpl as unknown as typeof fetch);

    const result = await client.getRenderStatus("render-1");

    expect(result).toEqual({
      id: "render-1",
      status: "done",
      url: "https://cdn.shotstack.io/out.mp4",
      error: null
    });
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("https://api.shotstack.io/edit/stage/render/render-1");
  });

  it("throws RendererRequestError for an unrecognized status value", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, response: { id: "render-1", status: "not-a-real-status" } })
    );
    const client = new ShotstackClient(config, fetchImpl as unknown as typeof fetch);

    await expect(client.getRenderStatus("render-1")).rejects.toThrow(RendererRequestError);
  });
});
