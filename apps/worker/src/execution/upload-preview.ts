import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ApiClient } from "../infrastructure/api-client.js";

export interface UploadPreviewParams {
  jobId: string;
  filePath: string;
}

export type UploadPreviewResult = { ok: true } | { ok: false; reason: string };

/**
 * Worker->API preview byte transfer (multi-scene-accumulation phase,
 * section 3: "Worker preview PNG -> authenticated upload") - the ONE
 * place a real captured preview's bytes ever leave this worker machine.
 * Reads the exact file PreviewCapture already proved exists and is
 * non-empty (execute-scene-edit-executor.ts never hands this a path it
 * has not itself just validated), then calls the real, worker-
 * authenticated upload endpoint - never a filesystem path trusted from
 * anywhere else. Mirrors upload-render-artifact.ts's own contract exactly.
 */
export interface PreviewUploader {
  upload(params: UploadPreviewParams): Promise<UploadPreviewResult>;
}

const PREVIEW_MIME_TYPE = "image/png";

export class HeroicSwanPreviewUploader implements PreviewUploader {
  constructor(
    private readonly apiClient: ApiClient,
    private readonly workerId: string,
    private readonly workerToken: string
  ) {}

  async upload(params: UploadPreviewParams): Promise<UploadPreviewResult> {
    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFile(params.filePath);
    } catch (error) {
      return { ok: false, reason: `could not read captured preview file: ${error instanceof Error ? error.message : String(error)}` };
    }

    try {
      await this.apiClient.uploadPreview(this.workerId, this.workerToken, params.jobId, fileBuffer, path.basename(params.filePath), PREVIEW_MIME_TYPE);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
