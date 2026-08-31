import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { JobRepository } from "../domain/job/types.js";
import type { WorkerRepository } from "../domain/worker/types.js";
import type { ExecutionSessionRepository } from "../domain/execution-session/types.js";
import type { FullPreviewArtifactRepository } from "../domain/full-preview-artifact/types.js";
import type { AssetStorage } from "../domain/asset-storage/types.js";
import { UnauthorizedError, PayloadTooLargeError } from "../errors/app-error.js";
import { extractBearerToken } from "../infrastructure/auth/bearer-token.js";
import { verifyToken } from "../infrastructure/auth/token.js";
import { uploadFullPreview } from "../application/job/upload-full-preview.js";

export interface FullPreviewUploadRouteDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  executionSessionRepository: ExecutionSessionRepository;
  fullPreviewArtifactRepository: FullPreviewArtifactRepository;
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
 * Worker->API complete-preview byte upload (client-handoff phase, "real
 * final preview approval gate", section 2) - worker-bearer-token
 * authenticated, same channel as claim/report/checkpoint, never a
 * session/browser endpoint. Mirrors render-artifact-upload.ts's own
 * multipart handling exactly, reusing the SAME larger upload ceiling (a
 * real complete-preview video is comparable in size to a real render).
 */
export function registerFullPreviewUploadRoutes(app: FastifyInstance, deps: FullPreviewUploadRouteDeps): void {
  const now = deps.now ?? (() => new Date());

  app.post("/api/workers/:workerId/jobs/:jobId/full-preview", async (request, reply) => {
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
      // @fastify/multipart enforces its own configured fileSize limit and
      // aborts the part stream with this specific code - same handling as
      // render-artifact-upload.ts's own identical case.
      if (error instanceof Error && "code" in error && (error as { code: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        throw new PayloadTooLargeError(deps.maxUploadBytes);
      }
      throw error;
    }

    const { fileBuffer: buffer, mimeType: parsedMimeType } = uploadFieldsSchema.parse({ fileBuffer, mimeType });

    const record = await uploadFullPreview(
      {
        jobRepository: deps.jobRepository,
        workerRepository: deps.workerRepository,
        executionSessionRepository: deps.executionSessionRepository,
        fullPreviewArtifactRepository: deps.fullPreviewArtifactRepository,
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
