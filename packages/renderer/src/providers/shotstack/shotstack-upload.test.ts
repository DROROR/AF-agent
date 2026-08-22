import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RendererNetworkError, RendererRequestError } from "../../errors.js";
import { uploadAssetToShotstack } from "./shotstack-upload.js";

const config = {
  apiKey: "test-key",
  baseUrl: "https://api.shotstack.io/edit/stage",
  env: "sandbox" as const
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("uploadAssetToShotstack", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "dyo-shotstack-upload-test-"));
    filePath = path.join(tempDir, "asset.png");
    writeFileSync(filePath, Buffer.from([1, 2, 3, 4]));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("uploads, polls, and returns the final ready source URL", async () => {
    const fetchImpl = vi.fn();
    fetchImpl
      // 1. POST /upload
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { id: "src-1", attributes: { url: "https://s3.example.com/presigned" } } })
      )
      // 2. PUT to presigned URL
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      // 3. GET /sources/src-1 - still importing
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { id: "src-1", attributes: { status: "importing" } } })
      )
      // 4. GET /sources/src-1 - ready
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: { id: "src-1", attributes: { status: "ready", source: "https://cdn.example.com/asset.png" } }
        })
      );

    const result = await uploadAssetToShotstack(
      filePath,
      config,
      fetchImpl as unknown as typeof fetch,
      5 // poll every 5ms in tests instead of the real 2s interval
    );

    expect(result).toEqual({ sourceId: "src-1", url: "https://cdn.example.com/asset.png" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const [uploadUrl, uploadInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(uploadUrl).toBe("https://api.shotstack.io/ingest/stage/upload");
    expect((uploadInit.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    const [putUrl, putInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(putUrl).toBe("https://s3.example.com/presigned");
    expect(putInit.method).toBe("PUT");
  });

  it("throws RendererRequestError when the source ends in failed status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { id: "src-1", attributes: { url: "https://s3.example.com/presigned" } } })
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { id: "src-1", attributes: { status: "failed", error: "corrupt file" } } })
      );

    await expect(
      uploadAssetToShotstack(filePath, config, fetchImpl as unknown as typeof fetch, 5)
    ).rejects.toThrow(RendererRequestError);
  });

  it("throws RendererNetworkError when requesting the upload URL fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      uploadAssetToShotstack(filePath, config, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(RendererNetworkError);
  });

  it("throws RendererRequestError when the PUT upload itself fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { id: "src-1", attributes: { url: "https://s3.example.com/presigned" } } })
      )
      .mockResolvedValueOnce(new Response(null, { status: 403 }));

    await expect(
      uploadAssetToShotstack(filePath, config, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(RendererRequestError);
  });
});
