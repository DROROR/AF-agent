import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroicSwanSceneEvidencePreviewUploader } from "./upload-scene-evidence-preview.js";
import type { ApiClient } from "../infrastructure/api-client.js";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function fakeApiClient(uploadSceneEvidencePreview: ApiClient["uploadSceneEvidencePreview"]): ApiClient {
  return { uploadSceneEvidencePreview } as unknown as ApiClient;
}

/**
 * Live QA regression (2026-09-07): a real INSPECT_SCENE_EVIDENCE job
 * captured a real, non-empty preview PNG on disk (confirmed by the
 * inspector's own `stat()` moments earlier), but the very next local
 * `readFile` of that exact path still failed - a transient Windows
 * file-readiness/lock condition, never a field-shape/path bug (traced end
 * to end: same `path` field name at every hop, see the source file's own
 * doc comment). Two failures compounded into a silent, undiagnosable gap:
 * the failure was never retried, and it was never logged anywhere. These
 * tests cover both fixes together: a small bounded retry around ONLY the
 * local read (never the HTTP upload), and clear final telemetry
 * (jobId/path/attempt count/OS error code+message) when every attempt is
 * exhausted - while preserving the exact same non-fatal {ok:false, reason}
 * contract job-dispatcher.ts already relies on (never throws).
 */
describe("HeroicSwanSceneEvidencePreviewUploader", () => {
  it("an immediate successful read uploads exactly once", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "scene-evidence-preview-upload-test-"));
    cleanupDirs.push(workDir);
    const filePath = join(workDir, "_Render_1788799767938.png");
    writeFileSync(filePath, Buffer.from("real png bytes"));

    const uploadSceneEvidencePreview = vi.fn().mockResolvedValue({
      id: "preview-1",
      jobId: "job-1",
      manifestCompositionId: "comp-210",
      byteSize: 15,
      sha256: "abc"
    });
    const uploader = new HeroicSwanSceneEvidencePreviewUploader(fakeApiClient(uploadSceneEvidencePreview), "worker-1", "token-1");

    const result = await uploader.upload({ jobId: "job-1", filePath });

    expect(result).toEqual({ ok: true });
    expect(uploadSceneEvidencePreview).toHaveBeenCalledTimes(1);
    expect(uploadSceneEvidencePreview).toHaveBeenCalledWith(
      "worker-1",
      "token-1",
      "job-1",
      Buffer.from("real png bytes"),
      "_Render_1788799767938.png",
      "image/png"
    );
  });

  it("a transient read failure (file not written yet) followed by success still uploads successfully - exactly once", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "scene-evidence-preview-upload-test-"));
    cleanupDirs.push(workDir);
    // Never created up front - the file genuinely does not exist yet when
    // the first read attempt runs, then appears mid-retry-window, the same
    // shape as the real Windows file-readiness race this fix targets.
    const filePath = join(workDir, "delayed-preview.png");
    const writeTimer = setTimeout(() => writeFileSync(filePath, Buffer.from("real png bytes")), 200);

    const uploadSceneEvidencePreview = vi.fn().mockResolvedValue({
      id: "preview-1",
      jobId: "job-1",
      manifestCompositionId: "comp-210",
      byteSize: 15,
      sha256: "abc"
    });
    const uploader = new HeroicSwanSceneEvidencePreviewUploader(fakeApiClient(uploadSceneEvidencePreview), "worker-1", "token-1");

    try {
      const result = await uploader.upload({ jobId: "job-1", filePath });
      expect(result).toEqual({ ok: true });
      // No duplicate successful uploads - retrying the READ never retries
      // (or duplicates) the HTTP upload call itself.
      expect(uploadSceneEvidencePreview).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(writeTimer);
    }
  });

  it("a permanent read failure exhausts the bounded retry window and returns ok:false, never throwing, without ever calling the API", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const uploadSceneEvidencePreview = vi.fn();
    const uploader = new HeroicSwanSceneEvidencePreviewUploader(fakeApiClient(uploadSceneEvidencePreview), "worker-1", "token-1");

    const start = Date.now();
    const result = await uploader.upload({ jobId: "job-1", filePath: "C:\\nonexistent\\preview.png" });
    const elapsedMs = Date.now() - start;

    expect(result.ok).toBe(false);
    expect(uploadSceneEvidencePreview).not.toHaveBeenCalled();
    // Bounded, not infinite/long: a few hundred ms of real retry delay,
    // never anywhere near a real "block the worker" duration.
    expect(elapsedMs).toBeLessThan(5000);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("final read failure telemetry names jobId, filePath, the attempt count, and the real OS error code/message - never hidden", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const uploadSceneEvidencePreview = vi.fn();
    const uploader = new HeroicSwanSceneEvidencePreviewUploader(fakeApiClient(uploadSceneEvidencePreview), "worker-1", "token-1");

    const result = await uploader.upload({ jobId: "job-42", filePath: "C:\\nonexistent\\preview.png" });

    expect(result.ok).toBe(false);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [logLine] = consoleError.mock.calls[0]!;
    expect(logLine).toContain("job-42");
    expect(logLine).toContain("C:\\nonexistent\\preview.png");
    expect(logLine).toContain("4 attempt(s)");
    expect(logLine).toContain("ENOENT");
    if (!result.ok) {
      expect(logLine).toContain(result.reason);
    }
  });

  it("an HTTP upload failure (real file, read succeeds) remains non-fatal and is logged with jobId/path/reason", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const workDir = mkdtempSync(join(tmpdir(), "scene-evidence-preview-upload-test-"));
    cleanupDirs.push(workDir);
    const filePath = join(workDir, "preview.png");
    writeFileSync(filePath, Buffer.from("real png bytes"));

    const uploadSceneEvidencePreview = vi.fn().mockRejectedValue(new Error("network down"));
    const uploader = new HeroicSwanSceneEvidencePreviewUploader(fakeApiClient(uploadSceneEvidencePreview), "worker-1", "token-1");

    const result = await uploader.upload({ jobId: "job-2", filePath });

    expect(result).toEqual({ ok: false, reason: "network down" });
    expect(uploadSceneEvidencePreview).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [logLine] = consoleError.mock.calls[0]!;
    expect(logLine).toContain("job-2");
    expect(logLine).toContain(filePath);
    expect(logLine).toContain("network down");
  });

  it("waits between read attempts rather than retrying instantly (a real, small bounded window, not a busy loop)", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "scene-evidence-preview-upload-test-"));
    cleanupDirs.push(workDir);
    const filePath = join(workDir, "delayed-preview.png");
    const writeTimer = setTimeout(() => writeFileSync(filePath, Buffer.from("real png bytes")), 500);

    const uploadSceneEvidencePreview = vi.fn().mockResolvedValue({ id: "preview-1", jobId: "job-1", manifestCompositionId: "comp-210", byteSize: 15, sha256: "abc" });
    const uploader = new HeroicSwanSceneEvidencePreviewUploader(fakeApiClient(uploadSceneEvidencePreview), "worker-1", "token-1");

    try {
      const start = Date.now();
      const result = await uploader.upload({ jobId: "job-1", filePath });
      const elapsedMs = Date.now() - start;
      expect(result).toEqual({ ok: true });
      // The file only appears at ~500ms - a genuinely instant (0-delay)
      // retry loop would never see it within the bounded attempt window.
      expect(elapsedMs).toBeGreaterThanOrEqual(400);
    } finally {
      clearTimeout(writeTimer);
    }
  });
});
