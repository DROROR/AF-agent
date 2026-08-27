import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAssetPath, type AssetDownloadClient } from "../asset-cache.js";
import { UnsafePathError } from "../../errors/worker-error.js";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function makeWorkRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "asset-cache-test-"));
  cleanupDirs.push(root);
  return root;
}

class FakeAssetDownloadClient implements AssetDownloadClient {
  calls: { jobId: string; assetId: string }[] = [];
  constructor(private readonly behavior: () => Buffer | Promise<Buffer>) {}
  async download(jobId: string, assetId: string): Promise<Buffer> {
    this.calls.push({ jobId, assetId });
    return this.behavior();
  }
}

describe("resolveAssetPath", () => {
  it("downloads, writes, and verifies a fresh asset", async () => {
    const workRoot = makeWorkRoot();
    const content = "real asset bytes";
    const client = new FakeAssetDownloadClient(() => Buffer.from(content));

    const result = await resolveAssetPath(client, {
      workRoot,
      jobId: "job-1",
      assetId: "22222222-2222-2222-2222-222222222222",
      expectedSha256: sha256(content),
      mimeType: "video/mp4"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(readFileSync(result.assetPath, "utf8")).toBe(content);
      expect(result.assetPath.endsWith(".mp4")).toBe(true);
    }
    expect(client.calls).toHaveLength(1);
  });

  it("is idempotent - reuses an already-downloaded, hash-matching file without downloading again", async () => {
    const workRoot = makeWorkRoot();
    const content = "same bytes every time";
    const client = new FakeAssetDownloadClient(() => Buffer.from(content));
    const params = {
      workRoot,
      jobId: "job-2",
      assetId: "22222222-2222-2222-2222-222222222222",
      expectedSha256: sha256(content),
      mimeType: "image/png"
    };

    const first = await resolveAssetPath(client, params);
    const second = await resolveAssetPath(client, params);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.assetPath).toBe(first.assetPath);
    }
    expect(client.calls).toHaveLength(1); // only the first call actually downloaded
  });

  it("re-downloads when an existing local file's content no longer matches the expected sha256", async () => {
    const workRoot = makeWorkRoot();
    const client = new FakeAssetDownloadClient(() => Buffer.from("the real, current bytes"));

    // First, seed a STALE file at the same derived path via a mismatched expectation (simulates an asset whose content changed since it was last cached).
    const staleClient = new FakeAssetDownloadClient(() => Buffer.from("stale old bytes"));
    const staleParams = {
      workRoot,
      jobId: "job-3",
      assetId: "22222222-2222-2222-2222-222222222222",
      expectedSha256: sha256("stale old bytes"),
      mimeType: "video/mp4"
    };
    const staleResult = await resolveAssetPath(staleClient, staleParams);
    expect(staleResult.ok).toBe(true);

    // Now resolve again with a DIFFERENT expected sha256 (the asset's real content changed) - the stale cached file must be replaced.
    const freshResult = await resolveAssetPath(client, {
      ...staleParams,
      expectedSha256: sha256("the real, current bytes")
    });

    expect(freshResult.ok).toBe(true);
    expect(client.calls).toHaveLength(1);
    if (freshResult.ok) {
      expect(readFileSync(freshResult.assetPath, "utf8")).toBe("the real, current bytes");
    }
  });

  it("deletes a freshly-downloaded file and reports failure when its sha256 does not match the expected value - never hands corrupt/wrong bytes to AE", async () => {
    const workRoot = makeWorkRoot();
    const client = new FakeAssetDownloadClient(() => Buffer.from("actually different bytes"));

    const result = await resolveAssetPath(client, {
      workRoot,
      jobId: "job-4",
      assetId: "22222222-2222-2222-2222-222222222222",
      expectedSha256: sha256("what we expected instead"),
      mimeType: "video/mp4"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("sha256");
    }
    // The corrupt/wrong file must not be left on disk.
    const assetsDir = join(workRoot, "jobs", "job-4", "assets");
    expect(() => readFileSync(join(assetsDir, "22222222-2222-2222-2222-222222222222.mp4"))).toThrow();
  });

  it("reports a clean failure (never throws) when the download itself fails", async () => {
    const workRoot = makeWorkRoot();
    const client = new FakeAssetDownloadClient(() => {
      throw new Error("ECONNREFUSED");
    });

    const result = await resolveAssetPath(client, {
      workRoot,
      jobId: "job-5",
      assetId: "22222222-2222-2222-2222-222222222222",
      expectedSha256: "a".repeat(64),
      mimeType: "video/mp4"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("download failed");
    }
  });

  it("picks a sensible file extension per mimeType, falling back to .bin for an unrecognized one", async () => {
    const workRoot = makeWorkRoot();
    const content = "bytes";
    const client = new FakeAssetDownloadClient(() => Buffer.from(content));

    const result = await resolveAssetPath(client, {
      workRoot,
      jobId: "job-6",
      assetId: "22222222-2222-2222-2222-222222222222",
      expectedSha256: sha256(content),
      mimeType: "application/x-totally-unknown"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assetPath.endsWith(".bin")).toBe(true);
    }
  });

  it("never writes outside the work root, even given an adversarial assetId (defense in depth - schema validation already rejects this upstream)", async () => {
    const workRoot = makeWorkRoot();
    const client = new FakeAssetDownloadClient(() => Buffer.from("x"));

    await expect(
      resolveAssetPath(client, {
        workRoot,
        jobId: "job-7",
        assetId: "../../../../etc/passwd",
        expectedSha256: "a".repeat(64),
        mimeType: "video/mp4"
      })
    ).rejects.toThrow(UnsafePathError);
  });
});
