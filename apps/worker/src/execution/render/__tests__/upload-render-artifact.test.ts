import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroicSwanRenderArtifactUploader } from "../upload-render-artifact.js";
import type { ApiClient } from "../../../infrastructure/api-client.js";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fakeApiClient(uploadRenderArtifact: ApiClient["uploadRenderArtifact"]): ApiClient {
  return { uploadRenderArtifact } as unknown as ApiClient;
}

describe("HeroicSwanRenderArtifactUploader", () => {
  it("reads the real file bytes and uploads them via the api client", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "upload-artifact-test-"));
    cleanupDirs.push(workDir);
    const filePath = join(workDir, "output.mp4");
    writeFileSync(filePath, Buffer.from("rendered bytes"));

    const uploadRenderArtifact = vi.fn().mockResolvedValue({
      id: "artifact-1",
      jobId: "job-1",
      variant: "LANDSCAPE",
      byteSize: 14,
      sha256: "abc"
    });
    const uploader = new HeroicSwanRenderArtifactUploader(fakeApiClient(uploadRenderArtifact), "worker-1", "token-1");

    const result = await uploader.upload({ jobId: "job-1", variant: "LANDSCAPE", filePath, mimeType: "video/mp4" });

    expect(result).toEqual({ ok: true });
    expect(uploadRenderArtifact).toHaveBeenCalledWith(
      "worker-1",
      "token-1",
      "job-1",
      "LANDSCAPE",
      Buffer.from("rendered bytes"),
      "output.mp4",
      "video/mp4"
    );
  });

  it("returns ok:false without throwing when the file does not exist", async () => {
    const uploadRenderArtifact = vi.fn();
    const uploader = new HeroicSwanRenderArtifactUploader(fakeApiClient(uploadRenderArtifact), "worker-1", "token-1");

    const result = await uploader.upload({
      jobId: "job-1",
      variant: "LANDSCAPE",
      filePath: "/nonexistent/output.mp4",
      mimeType: "video/mp4"
    });

    expect(result.ok).toBe(false);
    expect(uploadRenderArtifact).not.toHaveBeenCalled();
  });

  it("returns ok:false without throwing when the API call itself fails", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "upload-artifact-test-"));
    cleanupDirs.push(workDir);
    const filePath = join(workDir, "output.mp4");
    writeFileSync(filePath, Buffer.from("rendered bytes"));

    const uploadRenderArtifact = vi.fn().mockRejectedValue(new Error("network down"));
    const uploader = new HeroicSwanRenderArtifactUploader(fakeApiClient(uploadRenderArtifact), "worker-1", "token-1");

    const result = await uploader.upload({ jobId: "job-1", variant: "LANDSCAPE", filePath, mimeType: "video/mp4" });

    expect(result).toEqual({ ok: false, reason: "network down" });
  });
});
