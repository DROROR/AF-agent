import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { updateWorkMapRequestSchema } from "@dyo/schemas";
import type { WorkMapRepository } from "../domain/work-map/types.js";
import type { ProjectRepository } from "../domain/project/types.js";
import type { ExecutionPlanRepository } from "../domain/execution-plan/types.js";
import type { AssetRepository } from "../domain/asset/types.js";
import type { SceneEvidenceRepository } from "../domain/scene-evidence/types.js";
import type { UserAiProviderRepository } from "../domain/user-ai-provider/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { getWorkMap } from "../application/work-map/get-work-map.js";
import { updateWorkMap } from "../application/work-map/update-work-map.js";
import { generateAiWorkMapDraft } from "../application/work-map/generate-ai-work-map-draft.js";
import { resolveAiWorkMapProviderForUser } from "../application/work-map/resolve-ai-work-map-provider.js";

export interface WorkMapRouteDeps {
  workMapRepository: WorkMapRepository;
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  assetRepository: AssetRepository;
  sceneEvidenceRepository: SceneEvidenceRepository;
  userAiProviderRepository: UserAiProviderRepository;
  credentialsEncryptionKey: string | undefined;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  now?: () => Date;
}

const projectIdParamsSchema = z.object({ projectId: z.string().uuid() });

/** POST /api/projects/:projectId/work-map/ai-draft body - the ONLY free-text input this whole feature accepts from a normal user. */
const aiWorkMapDraftRequestSchema = z.object({ instructions: z.string().min(1) });

/** Real Work Map routes (asset-workmap-intake phase) - user/client INTENT, never a machine-observed source fact (see work-map.ts's own doc comment). */
export function registerWorkMapRoutes(app: FastifyInstance, deps: WorkMapRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  const sessionDeps = {
    sessionRepository: deps.sessionRepository,
    userRepository: deps.userRepository,
    verifySessionSecret,
    now
  };

  /** null (never 404) is a real, valid state - no work map has been saved yet. */
  app.get("/api/projects/:projectId/work-map", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const workMap = await getWorkMap({ workMapRepository: deps.workMapRepository }, projectId);
    reply.send({ workMap });
  });

  app.put("/api/projects/:projectId/work-map", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = updateWorkMapRequestSchema.parse(request.body);
    const workMap = await updateWorkMap({ workMapRepository: deps.workMapRepository, now }, projectId, body);
    reply.send({ workMap });
  });

  /**
   * "Tell AI what you want" - video-planning UX simplification, 2026-08-31.
   * Never mutates the execution plan, never runs AE, never accepts/creates
   * Mapping Assistant suggestions - only writes a new Work Map revision,
   * exactly like the manual PUT above (see generate-ai-work-map-draft.ts's
   * own doc comment).
   */
  app.post("/api/projects/:projectId/work-map/ai-draft", async (request, reply) => {
    const user = await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = aiWorkMapDraftRequestSchema.parse(request.body);
    const aiWorkMapProvider = await resolveAiWorkMapProviderForUser(
      { userAiProviderRepository: deps.userAiProviderRepository, credentialsEncryptionKey: deps.credentialsEncryptionKey },
      user.id
    );
    const workMap = await generateAiWorkMapDraft(
      {
        projectRepository: deps.projectRepository,
        executionPlanRepository: deps.executionPlanRepository,
        assetRepository: deps.assetRepository,
        workMapRepository: deps.workMapRepository,
        sceneEvidenceRepository: deps.sceneEvidenceRepository,
        aiWorkMapProvider,
        now,
        log: request.log
      },
      projectId,
      body.instructions
    );
    reply.status(201).send({ workMap });
  });
}
