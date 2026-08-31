import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { JobRepository } from "../domain/job/types.js";
import type { WorkerRepository } from "../domain/worker/types.js";
import type { AssetRepository } from "../domain/asset/types.js";
import type { AssetStorage } from "../domain/asset-storage/types.js";
import { UnauthorizedError } from "../errors/app-error.js";
import { extractBearerToken } from "../infrastructure/auth/bearer-token.js";
import { verifyToken } from "../infrastructure/auth/token.js";
import { getAssetFileForWorker } from "../application/asset/get-asset-file-for-worker.js";

export interface WorkerAssetDownloadRouteDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  assetRepository: AssetRepository;
  assetStorage: AssetStorage;
}

const paramsSchema = z.object({
  workerId: z.string().uuid(),
  jobId: z.string().uuid(),
  assetId: z.string().uuid()
});

/**
 * Client-handoff phase, section AA (security review) - `originalFilename`
 * is the browser-uploaded filename verbatim (routes/assets.ts's own
 * multipart handling never sanitizes it, by design - it is only ever
 * DISPLAYED elsewhere, never used to build a filesystem path), so it must
 * never be interpolated into this header unescaped: a filename containing
 * `"` would break out of the quoted value, and one containing CR/LF could
 * inject an extra header into the worker's response (Node's own header
 * validation already rejects raw CR/LF, but that means such a filename
 * would 500 this endpoint for every future download of that same asset -
 * a real, fixable DoS-by-upload, not merely a defensive nicety). Strips
 * C0/DEL control characters and escapes `"`/`\` per RFC 6266's own quoted-string rules.
 */
export function safeContentDispositionFilename(rawFilename: string): string {
  // eslint-disable-next-line no-control-regex
  const withoutControlChars = rawFilename.replace(/[\x00-\x1f\x7f]/g, "");
  return withoutControlChars.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Worker->API asset download (activation-phase Gap 2: MAP_FOOTAGE's asset
 * delivery pipeline) - worker-bearer-token authenticated, never a
 * session/browser endpoint, mirroring render-artifact-upload.ts's own
 * auth shape for the opposite transfer direction. Streams real bytes only
 * - never a storage key/filesystem path in the response.
 */
export function registerWorkerAssetDownloadRoutes(app: FastifyInstance, deps: WorkerAssetDownloadRouteDeps): void {
  app.get("/api/workers/:workerId/jobs/:jobId/assets/:assetId/file", async (request, reply) => {
    const { workerId, jobId, assetId } = paramsSchema.parse(request.params);
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedError("Missing worker token");
    }

    const file = await getAssetFileForWorker(
      {
        jobRepository: deps.jobRepository,
        workerRepository: deps.workerRepository,
        assetRepository: deps.assetRepository,
        assetStorage: deps.assetStorage,
        verifyToken
      },
      workerId,
      jobId,
      token,
      assetId
    );

    reply.header("content-type", file.mimeType);
    reply.header("content-disposition", `attachment; filename="${safeContentDispositionFilename(file.originalFilename)}"`);
    reply.send(file.buffer);
  });
}
