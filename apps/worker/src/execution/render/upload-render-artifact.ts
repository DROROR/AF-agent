import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RenderOutputVariant } from "@dyo/schemas";
import type { ApiClient } from "../../infrastructure/api-client.js";

export interface UploadRenderArtifactParams {
  jobId: string;
  variant: RenderOutputVariant;
  filePath: string;
  mimeType: string;
}

export type UploadRenderArtifactResult = { ok: true } | { ok: false; reason: string };

/**
 * Worker->API artifact byte transfer (render-delivery phase section 4) -
 * the ONE place a real render output's bytes ever leave this worker
 * machine. Reads the exact file RUN_AERENDER/VALIDATE_ARTIFACT already
 * proved exists and is non-empty (render-project-executor.ts never hands
 * this a path it has not itself just validated), then calls the real,
 * worker-authenticated upload endpoint - never a filesystem path/storage
 * key trusted from anywhere else.
 */
export interface RenderArtifactUploader {
  upload(params: UploadRenderArtifactParams): Promise<UploadRenderArtifactResult>;
}

export class HeroicSwanRenderArtifactUploader implements RenderArtifactUploader {
  constructor(
    private readonly apiClient: ApiClient,
    private readonly workerId: string,
    private readonly workerToken: string
  ) {}

  async upload(params: UploadRenderArtifactParams): Promise<UploadRenderArtifactResult> {
    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFile(params.filePath);
    } catch (error) {
      return { ok: false, reason: `could not read render output file: ${error instanceof Error ? error.message : String(error)}` };
    }

    try {
      await this.apiClient.uploadRenderArtifact(
        this.workerId,
        this.workerToken,
        params.jobId,
        params.variant,
        fileBuffer,
        path.basename(params.filePath),
        params.mimeType
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
