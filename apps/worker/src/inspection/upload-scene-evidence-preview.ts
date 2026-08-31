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
      fileBuffer = await readFile(params.filePath);
    } catch (error) {
      return { ok: false, reason: `could not read captured scene-evidence preview file: ${error instanceof Error ? error.message : String(error)}` };
    }

    try {
      await this.apiClient.uploadSceneEvidencePreview(this.workerId, this.workerToken, params.jobId, fileBuffer, path.basename(params.filePath), PREVIEW_MIME_TYPE);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
