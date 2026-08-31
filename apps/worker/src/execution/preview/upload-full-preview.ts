import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ApiClient } from "../../infrastructure/api-client.js";

export interface UploadFullPreviewParams {
  jobId: string;
  filePath: string;
  mimeType: string;
}

export type UploadFullPreviewResult = { ok: true } | { ok: false; reason: string };

/**
 * Worker->API complete-preview byte transfer (client-handoff completion
 * phase, section T) - the ONE place a real CREATE_PREVIEW output's bytes
 * ever leave this worker machine. Reads the exact file
 * create-full-preview-executor.ts already proved exists and is non-empty,
 * then calls the real, worker-authenticated upload endpoint - never a
 * filesystem path/storage key trusted from anywhere else. Mirrors
 * upload-render-artifact.ts's own shape exactly.
 */
export interface FullPreviewUploader {
  upload(params: UploadFullPreviewParams): Promise<UploadFullPreviewResult>;
}

export class HeroicSwanFullPreviewUploader implements FullPreviewUploader {
  constructor(
    private readonly apiClient: ApiClient,
    private readonly workerId: string,
    private readonly workerToken: string
  ) {}

  async upload(params: UploadFullPreviewParams): Promise<UploadFullPreviewResult> {
    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFile(params.filePath);
    } catch (error) {
      return { ok: false, reason: `could not read complete-preview output file: ${error instanceof Error ? error.message : String(error)}` };
    }

    try {
      await this.apiClient.uploadFullPreview(this.workerId, this.workerToken, params.jobId, fileBuffer, path.basename(params.filePath), params.mimeType);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
