import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { mediaKindSchema, updateAssetRequestSchema } from "@dyo/schemas";
import type { AssetRepository } from "../domain/asset/types.js";
import type { AssetStorage } from "../domain/asset-storage/types.js";
import type { ProjectRepository } from "../domain/project/types.js";
import type { ExecutionPlanRepository } from "../domain/execution-plan/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { AppError, PayloadTooLargeError } from "../errors/app-error.js";
import { uploadAsset } from "../application/asset/upload-asset.js";
import { listAssets } from "../application/asset/list-assets.js";
import { getAsset } from "../application/asset/get-asset.js";
import { getAssetFile } from "../application/asset/get-asset-file.js";
import { updateAsset } from "../application/asset/update-asset.js";
import { deleteAsset } from "../application/asset/delete-asset.js";

export interface AssetsRouteDeps {
  assetRepository: AssetRepository;
  assetStorage: AssetStorage;
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  maxUploadBytes: number;
  now?: () => Date;
}

const projectIdParamsSchema = z.object({ projectId: z.string().uuid() });
const assetParamsSchema = z.object({ projectId: z.string().uuid(), assetId: z.string().uuid() });

/**
 * Real Asset Catalog routes (asset-workmap-intake phase). Every route
 * requires an authenticated dashboard session, same as routes/projects.ts.
 * Upload never trusts the client's Content-Type/filename alone - see
 * upload-asset.ts and mime-allowlist.ts for the real validation.
 */
export function registerAssetRoutes(app: FastifyInstance, deps: AssetsRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  const sessionDeps = {
    sessionRepository: deps.sessionRepository,
    userRepository: deps.userRepository,
    verifySessionSecret,
    now
  };

  app.get("/api/projects/:projectId/assets", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const assets = await listAssets({ assetRepository: deps.assetRepository, projectRepository: deps.projectRepository }, projectId);
    reply.send({ assets });
  });

  app.post("/api/projects/:projectId/assets", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);

    let fileBuffer: Buffer | null = null;
    let originalFilename: string | null = null;
    let mimeType: string | null = null;
    let requestedMediaKind: ReturnType<typeof mediaKindSchema.parse> | null = null;

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          fileBuffer = await part.toBuffer();
          originalFilename = part.filename;
          mimeType = part.mimetype;
        } else if (part.fieldname === "mediaKind" && typeof part.value === "string") {
          const parsed = mediaKindSchema.safeParse(part.value);
          if (parsed.success) {
            requestedMediaKind = parsed.data;
          }
        }
      }
    } catch (error) {
      // @fastify/multipart enforces its own configured fileSize limit
      // (set to the same ASSET_MAX_UPLOAD_BYTES value in app.ts) and
      // aborts the part stream with this specific code BEFORE
      // uploadAsset() ever runs its own size check - translate it to the
      // same typed 413 the application layer would otherwise produce,
      // rather than letting a raw FastifyError fall through to a generic
      // 500 INTERNAL_ERROR.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "FST_REQ_FILE_TOO_LARGE") {
        throw new PayloadTooLargeError(deps.maxUploadBytes);
      }
      throw error;
    }

    if (!fileBuffer || !originalFilename || !mimeType) {
      throw new AppError("VALIDATION_ERROR", "A file part is required");
    }

    const asset = await uploadAsset(
      {
        assetRepository: deps.assetRepository,
        assetStorage: deps.assetStorage,
        projectRepository: deps.projectRepository,
        maxUploadBytes: deps.maxUploadBytes,
        now
      },
      projectId,
      { originalFilename, mimeType, buffer: fileBuffer, requestedMediaKind }
    );
    reply.status(201).send({ asset });
  });

  app.get("/api/projects/:projectId/assets/:assetId", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId, assetId } = assetParamsSchema.parse(request.params);
    const asset = await getAsset({ assetRepository: deps.assetRepository }, projectId, assetId);
    reply.send({ asset });
  });

  /** Streams the real bytes back for preview/download - never exposes a storage key or filesystem path in the response. */
  app.get("/api/projects/:projectId/assets/:assetId/file", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId, assetId } = assetParamsSchema.parse(request.params);
    const file = await getAssetFile({ assetRepository: deps.assetRepository, assetStorage: deps.assetStorage }, projectId, assetId);
    reply.header("content-type", file.mimeType);
    reply.send(file.buffer);
  });

  app.patch("/api/projects/:projectId/assets/:assetId", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId, assetId } = assetParamsSchema.parse(request.params);
    const body = updateAssetRequestSchema.parse(request.body);
    const asset = await updateAsset({ assetRepository: deps.assetRepository, now }, projectId, assetId, body);
    reply.send({ asset });
  });

  app.delete("/api/projects/:projectId/assets/:assetId", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId, assetId } = assetParamsSchema.parse(request.params);
    await deleteAsset(
      {
        assetRepository: deps.assetRepository,
        assetStorage: deps.assetStorage,
        executionPlanRepository: deps.executionPlanRepository,
        projectRepository: deps.projectRepository
      },
      projectId,
      assetId
    );
    reply.status(204).send();
  });
}
