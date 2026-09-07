import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ApiClient } from "../infrastructure/api-client.js";

export interface UploadSceneEvidencePreviewParams {
  jobId: string;
  filePath: string;
}

export type UploadSceneEvidencePreviewResult = { ok: true } | { ok: false; reason: string };

const PREVIEW_MIME_TYPE = "image/png";

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

/** Throws the LAST attempt's own error (with every earlier attempt simply discarded - only the final failure is ever reported) once every attempt has failed. */
async function readCapturedPreviewWithRetry(filePath: string): Promise<{ buffer: Buffer; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= READ_RETRY_ATTEMPTS; attempt++) {
    try {
      const buffer = await readFile(filePath);
      return { buffer, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < READ_RETRY_ATTEMPTS) {
        await sleep(READ_RETRY_DELAY_MS);
      }
    }
  }
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
 * job - the structural layer facts remain valid either way.
 */
export interface SceneEvidencePreviewUploader {
  upload(params: UploadSceneEvidencePreviewParams): Promise<UploadSceneEvidencePreviewResult>;
}

export class HeroicSwanSceneEvidencePreviewUploader implements SceneEvidencePreviewUploader {
  constructor(
    private readonly apiClient: ApiClient,
    private readonly workerId: string,
    private readonly workerToken: string
  ) {}

  async upload(params: UploadSceneEvidencePreviewParams): Promise<UploadSceneEvidencePreviewResult> {
    let fileBuffer: Buffer;
    try {
      const read = await readCapturedPreviewWithRetry(params.filePath);
      fileBuffer = read.buffer;
    } catch (error) {
      const reason = `could not read captured scene-evidence preview file after ${READ_RETRY_ATTEMPTS} attempt(s) [${errorCodeOf(error)}]: ${error instanceof Error ? error.message : String(error)}`;
      logUploadFailure(params, reason);
      return { ok: false, reason };
    }

    try {
      await this.apiClient.uploadSceneEvidencePreview(this.workerId, this.workerToken, params.jobId, fileBuffer, path.basename(params.filePath), PREVIEW_MIME_TYPE);
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logUploadFailure(params, reason);
      return { ok: false, reason };
    }
  }
}

/**
 * This upload is deliberately non-fatal to the INSPECT_SCENE_EVIDENCE job
 * (see this file's own doc comment) - but a silent, unlogged failure here
 * means a real captured preview can vanish between the Worker's own disk
 * and the dashboard with zero trace anywhere (the exact gap a live QA run
 * hit, 2026-09-07: job succeeded, file existed locally with real bytes,
 * but nothing - not the API's own request log, not this Worker's own
 * log - ever recorded that an upload was even attempted). jobId/path/
 * reason (which, for a read failure, already carries the attempt count
 * and OS error code - see readCapturedPreviewWithRetry above) are the
 * facts needed to diagnose it after the fact.
 */
function logUploadFailure(params: UploadSceneEvidencePreviewParams, reason: string): void {
  console.error(`[scene-evidence-preview-upload] failed jobId=${params.jobId} path=${params.filePath} reason=${reason}`);
}
