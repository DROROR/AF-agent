import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import type { Env } from "./env.js";
import type { JobRepository } from "./domain/job/types.js";
import type { WorkerRepository } from "./domain/worker/types.js";
import type { SessionRepository, UserRepository } from "./domain/auth/types.js";
import type { ExecutionPlanRepository } from "./domain/execution-plan/types.js";
import type { ProjectRepository } from "./domain/project/types.js";
import type { AssetRepository } from "./domain/asset/types.js";
import type { AssetStorage } from "./domain/asset-storage/types.js";
import type { WorkMapRepository } from "./domain/work-map/types.js";
import type { MappingSuggestionRepository } from "./domain/mapping-suggestion/types.js";
import type { SceneEvidenceRepository } from "./domain/scene-evidence/types.js";
import type { RenderArtifactRepository } from "./domain/render-artifact/types.js";
import type { RenderArtifactUploadRepository } from "./domain/render-artifact-upload/types.js";
import type { ExecutionSessionRepository } from "./domain/execution-session/types.js";
import type { UserAiProviderRepository } from "./domain/user-ai-provider/types.js";
import { registerErrorHandler } from "./errors/error-handler-plugin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerWorkerRoutes } from "./routes/workers.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerWorkMapRoutes } from "./routes/work-map.js";
import { registerMappingAssistantRoutes } from "./routes/mapping-assistant.js";
import { registerRenderArtifactRoutes } from "./routes/render-artifacts.js";
import { registerRenderArtifactUploadRoutes } from "./routes/render-artifact-upload.js";
import { registerWorkerAssetDownloadRoutes } from "./routes/worker-asset-download.js";
import { registerPreviewUploadRoutes } from "./routes/preview-upload.js";
import { registerExecutionSessionRoutes } from "./routes/execution-sessions.js";
import { registerUserAiProviderRoutes } from "./routes/user-ai-provider.js";

export interface AppDependencies {
  env: Pick<
    Env,
    | "WORKER_REGISTRATION_SECRET"
    | "WORKER_HEARTBEAT_STALE_AFTER_MS"
    | "LOG_LEVEL"
    | "ASSET_MAX_UPLOAD_BYTES"
    | "RENDER_ARTIFACT_MAX_UPLOAD_BYTES"
    | "CREDENTIALS_ENCRYPTION_KEY"
  >;
  workerRepository: WorkerRepository;
  jobRepository: JobRepository;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  assetRepository: AssetRepository;
  assetStorage: AssetStorage;
  workMapRepository: WorkMapRepository;
  mappingSuggestionRepository: MappingSuggestionRepository;
  sceneEvidenceRepository: SceneEvidenceRepository;
  renderArtifactRepository: RenderArtifactRepository;
  renderArtifactUploadRepository: RenderArtifactUploadRepository;
  executionSessionRepository: ExecutionSessionRepository;
  userAiProviderRepository: UserAiProviderRepository;
  checkDatabaseHealth: () => Promise<boolean>;
  now?: () => Date;
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.env.LOG_LEVEL,
      // Covers both worker bearer tokens and dashboard session tokens - the
      // same header carries either, and neither may ever reach the logs
      // (CLAUDE.md: "no password/token logging"). Request bodies (which is
      // where a signup/login password lives) are never logged by Fastify's
      // default logger in the first place.
      redact: ["req.headers.authorization"]
    }
  });

  // global: false - only routes that opt in via `config: { rateLimit }`
  // (POST /api/auth/login, /api/auth/signup) are limited; every other
  // route is unaffected.
  await app.register(rateLimit, { global: false });

  // Defense in depth alongside upload-asset.ts's own buffer-size check:
  // refuses an oversized file stream before it is ever fully buffered
  // into memory, not just after.
  await app.register(multipart, {
    limits: { fileSize: deps.env.ASSET_MAX_UPLOAD_BYTES, files: 1 }
  });

  registerErrorHandler(app);
  registerHealthRoutes(app, { checkDatabaseHealth: deps.checkDatabaseHealth });
  registerAuthRoutes(app, {
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerWorkerRoutes(app, {
    repository: deps.workerRepository,
    workerRegistrationSecret: deps.env.WORKER_REGISTRATION_SECRET,
    staleAfterMs: deps.env.WORKER_HEARTBEAT_STALE_AFTER_MS,
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerJobRoutes(app, {
    jobRepository: deps.jobRepository,
    workerRepository: deps.workerRepository,
    projectRepository: deps.projectRepository,
    executionPlanRepository: deps.executionPlanRepository,
    executionSessionRepository: deps.executionSessionRepository,
    assetRepository: deps.assetRepository,
    sceneEvidenceRepository: deps.sceneEvidenceRepository,
    renderArtifactRepository: deps.renderArtifactRepository,
    renderArtifactUploadRepository: deps.renderArtifactUploadRepository,
    staleAfterMs: deps.env.WORKER_HEARTBEAT_STALE_AFTER_MS,
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerExecutionSessionRoutes(app, {
    executionSessionRepository: deps.executionSessionRepository,
    executionPlanRepository: deps.executionPlanRepository,
    projectRepository: deps.projectRepository,
    workerRepository: deps.workerRepository,
    jobRepository: deps.jobRepository,
    assetStorage: deps.assetStorage,
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    staleAfterMs: deps.env.WORKER_HEARTBEAT_STALE_AFTER_MS,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerRenderArtifactRoutes(app, {
    renderArtifactRepository: deps.renderArtifactRepository,
    assetStorage: deps.assetStorage,
    projectRepository: deps.projectRepository,
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerRenderArtifactUploadRoutes(app, {
    jobRepository: deps.jobRepository,
    workerRepository: deps.workerRepository,
    renderArtifactUploadRepository: deps.renderArtifactUploadRepository,
    assetStorage: deps.assetStorage,
    maxUploadBytes: deps.env.RENDER_ARTIFACT_MAX_UPLOAD_BYTES,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerWorkerAssetDownloadRoutes(app, {
    jobRepository: deps.jobRepository,
    workerRepository: deps.workerRepository,
    assetRepository: deps.assetRepository,
    assetStorage: deps.assetStorage
  });
  registerPreviewUploadRoutes(app, {
    jobRepository: deps.jobRepository,
    workerRepository: deps.workerRepository,
    executionSessionRepository: deps.executionSessionRepository,
    assetStorage: deps.assetStorage,
    maxUploadBytes: deps.env.ASSET_MAX_UPLOAD_BYTES,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerProjectRoutes(app, {
    projectRepository: deps.projectRepository,
    executionPlanRepository: deps.executionPlanRepository,
    assetRepository: deps.assetRepository,
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerAssetRoutes(app, {
    assetRepository: deps.assetRepository,
    assetStorage: deps.assetStorage,
    projectRepository: deps.projectRepository,
    executionPlanRepository: deps.executionPlanRepository,
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    maxUploadBytes: deps.env.ASSET_MAX_UPLOAD_BYTES,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerWorkMapRoutes(app, {
    workMapRepository: deps.workMapRepository,
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerMappingAssistantRoutes(app, {
    projectRepository: deps.projectRepository,
    executionPlanRepository: deps.executionPlanRepository,
    assetRepository: deps.assetRepository,
    workMapRepository: deps.workMapRepository,
    mappingSuggestionRepository: deps.mappingSuggestionRepository,
    sceneEvidenceRepository: deps.sceneEvidenceRepository,
    userAiProviderRepository: deps.userAiProviderRepository,
    credentialsEncryptionKey: deps.env.CREDENTIALS_ENCRYPTION_KEY,
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    ...(deps.now ? { now: deps.now } : {})
  });
  registerUserAiProviderRoutes(app, {
    userAiProviderRepository: deps.userAiProviderRepository,
    credentialsEncryptionKey: deps.env.CREDENTIALS_ENCRYPTION_KEY,
    userRepository: deps.userRepository,
    sessionRepository: deps.sessionRepository,
    ...(deps.now ? { now: deps.now } : {})
  });

  return app;
}
