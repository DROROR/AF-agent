import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroicSwanSceneEvidencePreviewUploader, type SceneEvidencePreviewUploadLogger } from "./upload-scene-evidence-preview.js";
import type { ApiClient } from "../infrastructure/api-client.js";
import { ApiResponseError } from "../errors/worker-error.js";

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

interface RecordedLogCall {
  level: "info" | "warn";
  details: Record<string, unknown>;
  message: string;
}

function recordingLogger(): { logger: SceneEvidencePreviewUploadLogger; calls: RecordedLogCall[] } {
  const calls: RecordedLogCall[] = [];
  return {
    logger: {
      info: (details, message) => calls.push({ level: "info", details, message }),
      warn: (details, message) => calls.push({ level: "warn", details, message })
    },
    calls
  };
}

/**
 * Live QA regression (2026-09-07): a real INSPECT_SCENE_EVIDENCE job
 * captured a real, non-empty preview PNG on disk (confirmed by the
 * inspector's own `stat()` moments earlier), but the very next local
 * `readFile` of that exact path still failed - a transient Windows
 * file-readiness/lock condition, never a field-shape/path bug (traced end
 * to end: same `path` field name at every hop, see the source file's own
 * doc comment). Worse, a plain `console.error` added right after that
 * incident never showed up in the real worker.log at all when retried
 * live, so this class now takes an injected structured logger (the SAME
 * kind of object index.ts's own workerLogger already is, proven to reach
 * worker.log) instead. These tests cover: the bounded local-read-only
 * retry, every documented stage being logged, a final read failure never
 * being silent, and the existing non-fatal {ok:false, reason} contract
 * (never throws) staying exactly as job-dispatcher.ts already relies on.
 */
describe("HeroicSwanSceneEvidencePreviewUploader", () => {
  it("an immediate successful read uploads exactly once, logging read-start/read-success/http-start/http-success", async () => {
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
    const { logger, calls } = recordingLogger();
    const uploader = new HeroicSwanSceneEvidencePreviewUploader(fakeApiClient(uploadSceneEvidencePreview), "worker-1", "token-1", logger);

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

    const stages = calls.map((call) => call.details["stage"]);
    expect(stages).toEqual(["read-start", "read-success", "http-start", "http-success"]);
    for (const call of calls) {
      expect(call.details["jobId"]).toBe("job-1");
      expect(call.details["filePath"]).toBe(filePath);
    }
  });

  it("a transient read failure (file not written yet) followed by success still uploads successfully - exactly once, logging the failed attempt then read-success", async () => {
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
    const { logger, calls } = recordingLogger();
    const uploader = new HeroicSwanSceneEvidencePreviewUploader(fakeApiClient(uploadSceneEvidencePreview), "worker-1", "token-1", logger);

    try {
      const result = await uploader.upload({ jobId: "job-1", filePath });
      expect(result).toEqual({ ok: true });
      // No duplicate successful uploads - retrying the READ never retries
      // (or duplicates) the HTTP upload call itself.
      expect(uploadSceneEvidencePreview).toHaveBeenCalledTimes(1);

      const stages = calls.map((call) => call.details["stage"]);
      expect(stages[0]).toBe("read-start");
      expect(stages).toContain("read-failed");
      expect(stages).toContain("read-success");
      expect(stages.at(-2)).toBe("http-start");
      expect(stages.at(-1)).toBe("http-success");

      const readFailedCall = calls.find((call) => call.details["stage"] === "read-failed")!;
      expect(readFailedCall.level).toBe("warn");
      expect(readFailedCall.details["errorCode"]).toBe("ENOENT");
    } finally {
      clearTimeout(writeTimer);
    }
  });

  it("a permanent read failure exhausts the bounded retry window and returns ok:false, never throwing, without ever calling the API - and is never silent", async () => {
    const uploadSceneEvidencePreview = vi.fn();
    const { logger, calls } = recordingLogger();
    const uploader = new HeroicSwanSceneEvidencePreviewUploader(fakeApiClient(uploadSceneEvidencePreview), "worker-1", "token-1", logger);

    const start = Date.now();
    const result = await uploader.upload({ jobId: "job-42", filePath: "C:\\nonexistent\\preview.png" });
    const elapsedMs = Date.now() - start;

    expect(result.ok).toBe(false);
    expect(uploadSceneEvidencePreview).not.toHaveBeenCalled();
    // Bounded, not infinite/long: a few hundred ms of real retry delay,
    // never anywhere near a real "block the worker" duration.
    expect(elapsedMs).toBeLessThan(5000);

    // Final failure telemetry names jobId, filePath, the attempt count,
    // and the real OS error code/message - never hidden.
    const finalFailure = calls.at(-1)!;
    expect(finalFailure.level).toBe("warn");
    expect(finalFailure.details["jobId"]).toBe("job-42");
    expect(finalFailure.details["filePath"]).toBe("C:\\nonexistent\\preview.png");
    expect(finalFailure.details["attempts"]).toBe(4);
    expect(finalFailure.details["errorCode"]).toBe("ENOENT");
    if (!result.ok) {
      expect(result.reason).toContain("4 attempt(s)");
      expect(result.reason).toContain("ENOENT");
    }
    // Never an http-* stage - the read never succeeded, so the upload was
    // genuinely never attempted.
    expect(calls.some((call) => String(call.details["stage"]).startsWith("http"))).toBe(false);
  });

  it("an HTTP upload failure (real file, read succeeds) remains non-fatal and logs an http-failed stage with jobId/path/status/reason", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "scene-evidence-preview-upload-test-"));
    cleanupDirs.push(workDir);
    const filePath = join(workDir, "preview.png");
    writeFileSync(filePath, Buffer.from("real png bytes"));

    const uploadSceneEvidencePreview = vi.fn().mockRejectedValue(new ApiResponseError('{"code":"INTERNAL_ERROR"}', 500));
    const { logger, calls } = recordingLogger();
    const uploader = new HeroicSwanSceneEvidencePreviewUploader(fakeApiClient(uploadSceneEvidencePreview), "worker-1", "token-1", logger);

    const result = await uploader.upload({ jobId: "job-2", filePath });

    expect(result).toEqual({ ok: false, reason: '{"code":"INTERNAL_ERROR"}' });
    expect(uploadSceneEvidencePreview).toHaveBeenCalledTimes(1);

    const httpFailed = calls.find((call) => call.details["stage"] === "http-failed")!;
    expect(httpFailed.level).toBe("warn");
    expect(httpFailed.details["jobId"]).toBe("job-2");
    expect(httpFailed.details["filePath"]).toBe(filePath);
    expect(httpFailed.details["httpStatus"]).toBe(500);
    expect(httpFailed.details["errorMessage"]).toBe('{"code":"INTERNAL_ERROR"}');
  });

  it("waits between read attempts rather than retrying instantly (a real, small bounded window, not a busy loop)", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "scene-evidence-preview-upload-test-"));
    cleanupDirs.push(workDir);
    const filePath = join(workDir, "delayed-preview.png");
    const writeTimer = setTimeout(() => writeFileSync(filePath, Buffer.from("real png bytes")), 500);

    const uploadSceneEvidencePreview = vi.fn().mockResolvedValue({ id: "preview-1", jobId: "job-1", manifestCompositionId: "comp-210", byteSize: 15, sha256: "abc" });
    const { logger } = recordingLogger();
    const uploader = new HeroicSwanSceneEvidencePreviewUploader(fakeApiClient(uploadSceneEvidencePreview), "worker-1", "token-1", logger);

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
