import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { JobRepository } from "../domain/job/types.js";
import type { WorkerRepository } from "../domain/worker/types.js";
import type { SceneEvidencePreviewRepository } from "../domain/scene-evidence-preview/types.js";
import type { AssetStorage } from "../domain/asset-storage/types.js";
import { UnauthorizedError, PayloadTooLargeError } from "../errors/app-error.js";
import { extractBearerToken } from "../infrastructure/auth/bearer-token.js";
import { verifyToken } from "../infrastructure/auth/token.js";
import { uploadSceneEvidencePreview } from "../application/job/upload-scene-evidence-preview.js";

export interface SceneEvidencePreviewUploadRouteDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  sceneEvidencePreviewRepository: SceneEvidencePreviewRepository;
  assetStorage: AssetStorage;
  maxUploadBytes: number;
  now?: () => Date;
}

const jobParamsSchema = z.object({ workerId: z.string().uuid(), jobId: z.string().uuid() });
const uploadFieldsSchema = z.object({
  fileBuffer: z.instanceof(Buffer, { message: "A file part is required" }),
  mimeType: z.string().min(1, "A mimetype is required")
});

/**
 * Worker->API scene-evidence preview byte upload (client-facing UX
 * redesign, "M. VISUAL PREVIEWS ARE MANDATORY") - worker-bearer-token
 * authenticated, same channel as claim/report/checkpoint, never a
 * session/browser endpoint. Mirrors full-preview-upload.ts's own
 * multipart handling exactly - a single evidence-frame PNG is small, so
 * this reuses the SAME asset/render upload ceiling rather than a separate
 * one.
 */
export function registerSceneEvidencePreviewUploadRoutes(app: FastifyInstance, deps: SceneEvidencePreviewUploadRouteDeps): void {
  const now = deps.now ?? (() => new Date());

  app.post("/api/workers/:workerId/jobs/:jobId/scene-evidence-preview", async (request, reply) => {
    const { workerId, jobId } = jobParamsSchema.parse(request.params);
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedError("Missing worker token");
    }

    let fileBuffer: Buffer | null = null;
    let mimeType: string | null = null;

    try {
      for await (const part of request.parts({ limits: { fileSize: deps.maxUploadBytes, files: 1 } })) {
        if (part.type === "file") {
          fileBuffer = await part.toBuffer();
          mimeType = part.mimetype;
        }
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as { code: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        throw new PayloadTooLargeError(deps.maxUploadBytes);
      }
      throw error;
    }

    const { fileBuffer: buffer, mimeType: parsedMimeType } = uploadFieldsSchema.parse({ fileBuffer, mimeType });

    const record = await uploadSceneEvidencePreview(
      {
        jobRepository: deps.jobRepository,
        workerRepository: deps.workerRepository,
        sceneEvidencePreviewRepository: deps.sceneEvidencePreviewRepository,
        assetStorage: deps.assetStorage,
        verifyToken,
        maxUploadBytes: deps.maxUploadBytes,
        now
      },
      workerId,
      jobId,
      token,
      { mimeType: parsedMimeType, buffer }
    );

    reply.status(201).send({
      id: record.id,
      jobId: record.jobId,
      byteSize: record.byteSize,
      sha256: record.sha256
    });
  });
}
