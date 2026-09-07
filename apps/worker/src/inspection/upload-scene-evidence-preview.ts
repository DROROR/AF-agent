import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ApiClient } from "../infrastructure/api-client.js";
import { ApiResponseError } from "../errors/worker-error.js";

export interface UploadSceneEvidencePreviewParams {
  jobId: string;
  filePath: string;
}

export type UploadSceneEvidencePreviewResult = { ok: true } | { ok: false; reason: string };

const PREVIEW_MIME_TYPE = "image/png";

/**
 * Minimal, pino-compatible logging surface - see job-dispatcher.ts's own
 * JobDispatcherLogger doc comment (same rationale, same shape). Never
 * logs workerToken/credentials.
 */
export interface SceneEvidencePreviewUploadLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
}

/**
 * Bounded retry around ONLY the local file read, never the HTTP upload
 * itself (live QA regression, 2026-09-07): a real job's own composition/
 * layer processing already confirmed this exact path existed with a real,
 * non-empty size via `stat()` moments earlier (see
 * heroic-swan-scene-evidence-inspector.ts), yet the very next `readFile`
 * of that same path still failed - a transient Windows file-readiness/
 * lock condition (AE/ae-mcp/antivirus can hold a brief exclusive handle
 * on a just-written file even after `stat` already sees its final size),
 * not a field-shape/path bug (traced end to end: `ae_capture_frame`'s own
 * parser -> `preview.path` -> this function's own `filePath` param, same
 * field name at every hop). A handful of short retries absorbs exactly
 * that window without ever blocking the worker for long or retrying
 * forever - three retries at 400ms apart is at most 1.2s of extra wait.
 */
const READ_RETRY_ATTEMPTS = 4;
const READ_RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCodeOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof (error as { code: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return "UNKNOWN";
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readCapturedPreviewWithRetry(
  params: UploadSceneEvidencePreviewParams,
  logger: SceneEvidencePreviewUploadLogger
): Promise<{ buffer: Buffer; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= READ_RETRY_ATTEMPTS; attempt++) {
    try {
      const buffer = await readFile(params.filePath);
      logger.info({ jobId: params.jobId, filePath: params.filePath, stage: "read-success", attempt }, "[scene-evidence-preview-upload] local preview file read succeeded");
      return { buffer, attempts: attempt };
    } catch (error) {
      lastError = error;
      logger.warn(
        {
          jobId: params.jobId,
          filePath: params.filePath,
          stage: "read-failed",
          attempt,
          errorCode: errorCodeOf(error),
          errorMessage: errorMessageOf(error)
        },
        "[scene-evidence-preview-upload] local preview file read attempt failed"
      );
      if (attempt < READ_RETRY_ATTEMPTS) {
        await sleep(READ_RETRY_DELAY_MS);
      }
    }
  }
  // Every attempt failed - re-thrown as-is (the LAST attempt's own real
  // error) so the caller below can build one final, complete reason/log
  // line from it; every earlier attempt's error was already logged above.
  throw lastError;
}

/**
 * Worker->API scene-evidence preview byte transfer (client-facing UX
 * redesign, "M. VISUAL PREVIEWS ARE MANDATORY") - the ONE place a real
 * captured scene-evidence frame's bytes ever leave this worker machine.
 * Mirrors upload-preview.ts/execution/preview/upload-full-preview.ts's
 * exact contract - reads the exact file the inspector already proved
 * exists and is non-empty, then calls the real, worker-authenticated
 * upload endpoint. Best-effort: a failure here is caught by the caller
 * (job-dispatcher.ts) and never fails the whole INSPECT_SCENE_EVIDENCE
 * job - the structural layer facts remain valid either way. Every stage
 * (read-start/read-success/read-failed/http-start/http-success/
 * http-failed) is logged via the injected structured logger (the SAME
 * mechanism index.ts's own workerLogger already uses, proven to reach
 * worker.log - see supervisor/spawn-worker-child.ts's stdout/stderr
 * piping) so a real failure is never silent again (live QA regression,
 * 2026-09-07: a real captured preview vanished with zero trace anywhere).
 */
export interface SceneEvidencePreviewUploader {
  upload(params: UploadSceneEvidencePreviewParams): Promise<UploadSceneEvidencePreviewResult>;
}

export class HeroicSwanSceneEvidencePreviewUploader implements SceneEvidencePreviewUploader {
  constructor(
    private readonly apiClient: ApiClient,
    private readonly workerId: string,
    private readonly workerToken: string,
    private readonly logger: SceneEvidencePreviewUploadLogger
  ) {}

  async upload(params: UploadSceneEvidencePreviewParams): Promise<UploadSceneEvidencePreviewResult> {
    this.logger.info({ jobId: params.jobId, filePath: params.filePath, stage: "read-start" }, "[scene-evidence-preview-upload] starting local preview file read");

    let fileBuffer: Buffer;
    try {
      const read = await readCapturedPreviewWithRetry(params, this.logger);
      fileBuffer = read.buffer;
    } catch (error) {
      const reason = `could not read captured scene-evidence preview file after ${READ_RETRY_ATTEMPTS} attempt(s) [${errorCodeOf(error)}]: ${errorMessageOf(error)}`;
      this.logger.warn(
        {
          jobId: params.jobId,
          filePath: params.filePath,
          stage: "read-failed",
          attempts: READ_RETRY_ATTEMPTS,
          errorCode: errorCodeOf(error),
          errorMessage: errorMessageOf(error)
        },
        "[scene-evidence-preview-upload] exhausted local preview file read retries - upload not attempted"
      );
      return { ok: false, reason };
    }

    this.logger.info({ jobId: params.jobId, filePath: params.filePath, stage: "http-start" }, "[scene-evidence-preview-upload] starting API upload");
    try {
      await this.apiClient.uploadSceneEvidencePreview(this.workerId, this.workerToken, params.jobId, fileBuffer, path.basename(params.filePath), PREVIEW_MIME_TYPE);
      this.logger.info({ jobId: params.jobId, filePath: params.filePath, stage: "http-success" }, "[scene-evidence-preview-upload] API upload succeeded");
      return { ok: true };
    } catch (error) {
      const reason = errorMessageOf(error);
      this.logger.warn(
        {
          jobId: params.jobId,
          filePath: params.filePath,
          stage: "http-failed",
          httpStatus: error instanceof ApiResponseError ? error.statusCode : undefined,
          errorMessage: reason
        },
        "[scene-evidence-preview-upload] API upload failed"
      );
      return { ok: false, reason };
    }
  }
}
