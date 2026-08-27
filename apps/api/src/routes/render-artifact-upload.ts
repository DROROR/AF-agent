import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { renderOutputVariantSchema } from "@dyo/schemas";
import type { JobRepository } from "../domain/job/types.js";
import type { WorkerRepository } from "../domain/worker/types.js";
import type { RenderArtifactUploadRepository } from "../domain/render-artifact-upload/types.js";
import type { AssetStorage } from "../domain/asset-storage/types.js";
import { UnauthorizedError, PayloadTooLargeError } from "../errors/app-error.js";
import { extractBearerToken } from "../infrastructure/auth/bearer-token.js";
import { verifyToken } from "../infrastructure/auth/token.js";
import { uploadRenderArtifact } from "../application/job/upload-render-artifact.js";

export interface RenderArtifactUploadRouteDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  renderArtifactUploadRepository: RenderArtifactUploadRepository;
  assetStorage: AssetStorage;
  maxUploadBytes: number;
  now?: () => Date;
}

const jobParamsSchema = z.object({ workerId: z.string().uuid(), jobId: z.string().uuid() });
const uploadFieldsSchema = z.object({
  variant: renderOutputVariantSchema,
  fileBuffer: z.instanceof(Buffer, { message: "A file part is required" }),
  mimeType: z.string().min(1, "A mimetype is required")
});

/**
 * Worker->API artifact byte upload (render-delivery phase section 4) -
 * worker-bearer-token authenticated (same channel as claim/report/
 * checkpoint), never a session/browser endpoint. A separate, larger
 * multipart size ceiling than the browser's own asset-upload route (real
 * rendered videos are far bigger than typical input assets) - passed
 * explicitly to THIS call only (see @fastify/multipart's own per-call
 * `limits` override), never raising the global app-wide default.
 */
export function registerRenderArtifactUploadRoutes(app: FastifyInstance, deps: RenderArtifactUploadRouteDeps): void {
  const now = deps.now ?? (() => new Date());

  app.post("/api/workers/:workerId/jobs/:jobId/artifact", async (request, reply) => {
    const { workerId, jobId } = jobParamsSchema.parse(request.params);
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedError("Missing worker token");
    }

    let fileBuffer: Buffer | null = null;
    let mimeType: string | null = null;
    let rawVariant: string | null = null;

    try {
      for await (const part of request.parts({ limits: { fileSize: deps.maxUploadBytes, files: 1 } })) {
        if (part.type === "file") {
          fileBuffer = await part.toBuffer();
          mimeType = part.mimetype;
        } else if (part.fieldname === "variant" && typeof part.value === "string") {
          rawVariant = part.value;
        }
      }
    } catch (error) {
      // @fastify/multipart enforces its own configured fileSize limit and
      // aborts the part stream with this specific code BEFORE the whole
      // buffer is ever held in memory - translated to the same typed
      // PayloadTooLargeError the application layer's own defense-in-depth
      // check would otherwise raise (mirrors routes/assets.ts's own
      // handling of this exact library behavior).
      if (error instanceof Error && "code" in error && (error as { code: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        throw new PayloadTooLargeError(deps.maxUploadBytes);
      }
      throw error;
    }

    const { variant, fileBuffer: buffer, mimeType: parsedMimeType } = uploadFieldsSchema.parse({
      variant: rawVariant,
      fileBuffer,
      mimeType
    });

    const record = await uploadRenderArtifact(
      {
        jobRepository: deps.jobRepository,
        workerRepository: deps.workerRepository,
        renderArtifactUploadRepository: deps.renderArtifactUploadRepository,
        assetStorage: deps.assetStorage,
        verifyToken,
        maxUploadBytes: deps.maxUploadBytes,
        now
      },
      workerId,
      jobId,
      token,
      { variant, mimeType: parsedMimeType, buffer }
    );

    reply.status(201).send({
      id: record.id,
      jobId: record.jobId,
      variant: record.variant,
      byteSize: record.byteSize,
      sha256: record.sha256
    });
  });
}
