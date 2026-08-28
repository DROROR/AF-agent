import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { JobRepository } from "../domain/job/types.js";
import type { WorkerRepository } from "../domain/worker/types.js";
import type { ExecutionSessionRepository } from "../domain/execution-session/types.js";
import type { AssetStorage } from "../domain/asset-storage/types.js";
import { UnauthorizedError, PayloadTooLargeError } from "../errors/app-error.js";
import { extractBearerToken } from "../infrastructure/auth/bearer-token.js";
import { verifyToken } from "../infrastructure/auth/token.js";
import { uploadPreview } from "../application/job/upload-preview.js";

export interface PreviewUploadRouteDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  executionSessionRepository: ExecutionSessionRepository;
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
 * Worker->API preview byte upload (multi-scene-accumulation phase,
 * section 3) - worker-bearer-token authenticated (same channel as
 * claim/report/checkpoint/artifact upload), never a session/browser
 * endpoint. Mirrors registerRenderArtifactUploadRoutes' exact multipart-
 * parsing shape.
 */
export function registerPreviewUploadRoutes(app: FastifyInstance, deps: PreviewUploadRouteDeps): void {
  const now = deps.now ?? (() => new Date());

  app.post("/api/workers/:workerId/jobs/:jobId/preview", async (request, reply) => {
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
      // @fastify/multipart's own configured fileSize limit - same
      // translation to PayloadTooLargeError registerRenderArtifactUploadRoutes
      // already applies for this exact library behavior.
      if (error instanceof Error && "code" in error && (error as { code: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        throw new PayloadTooLargeError(deps.maxUploadBytes);
      }
      throw error;
    }

    const { fileBuffer: buffer, mimeType: parsedMimeType } = uploadFieldsSchema.parse({ fileBuffer, mimeType });

    const result = await uploadPreview(
      {
        jobRepository: deps.jobRepository,
        workerRepository: deps.workerRepository,
        executionSessionRepository: deps.executionSessionRepository,
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

    reply.status(201).send(result);
  });
}
