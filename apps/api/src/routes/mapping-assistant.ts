import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { acceptMappingSuggestionRequestSchema, batchAcceptMappingSuggestionsRequestSchema } from "@dyo/schemas";
import type { AssetRepository } from "../domain/asset/types.js";
import type { ExecutionPlanRepository } from "../domain/execution-plan/types.js";
import type { ProjectRepository } from "../domain/project/types.js";
import type { WorkMapRepository } from "../domain/work-map/types.js";
import type { MappingSuggestionRepository } from "../domain/mapping-suggestion/types.js";
import type { SceneEvidenceRepository } from "../domain/scene-evidence/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import type { UserAiProviderRepository } from "../domain/user-ai-provider/types.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { resolveAiSuggestionProviderForUser } from "../application/mapping-assistant/resolve-ai-suggestion-provider.js";
import { generateMappingSuggestions } from "../application/mapping-assistant/generate-mapping-suggestions.js";
import { listMappingSuggestions } from "../application/mapping-assistant/list-mapping-suggestions.js";
import { acceptMappingSuggestion } from "../application/mapping-assistant/accept-mapping-suggestion.js";
import { rejectMappingSuggestion } from "../application/mapping-assistant/reject-mapping-suggestion.js";
import { batchAcceptMappingSuggestions } from "../application/mapping-assistant/batch-accept-mapping-suggestions.js";

export interface MappingAssistantRouteDeps {
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  assetRepository: AssetRepository;
  workMapRepository: WorkMapRepository;
  mappingSuggestionRepository: MappingSuggestionRepository;
  sceneEvidenceRepository: SceneEvidenceRepository;
  userAiProviderRepository: UserAiProviderRepository;
  credentialsEncryptionKey: string | undefined;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  now?: () => Date;
}

const projectIdParamsSchema = z.object({ projectId: z.string().uuid() });
const suggestionParamsSchema = z.object({ projectId: z.string().uuid(), suggestionId: z.string().min(1) });

/**
 * Mapping Assistant routes (evidence-backed mapping suggestions phase).
 * Every route requires an authenticated dashboard session, same as
 * routes/assets.ts and routes/work-map.ts. Never a route that itself
 * mutates the execution plan without an explicit accept - generate/list
 * are read/propose-only, accept/reject are the only two that ever change
 * suggestion state, and accept is the only one that ever edits the plan
 * (via the exact same typed edit operations a human uses manually).
 */
export function registerMappingAssistantRoutes(app: FastifyInstance, deps: MappingAssistantRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  const sessionDeps = {
    sessionRepository: deps.sessionRepository,
    userRepository: deps.userRepository,
    verifySessionSecret,
    now
  };

  app.post("/api/projects/:projectId/mapping-suggestions/generate", async (request, reply) => {
    const user = await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const aiSuggestionProvider = await resolveAiSuggestionProviderForUser(
      { userAiProviderRepository: deps.userAiProviderRepository, credentialsEncryptionKey: deps.credentialsEncryptionKey },
      user.id
    );
    const result = await generateMappingSuggestions(
      {
        projectRepository: deps.projectRepository,
        executionPlanRepository: deps.executionPlanRepository,
        assetRepository: deps.assetRepository,
        workMapRepository: deps.workMapRepository,
        mappingSuggestionRepository: deps.mappingSuggestionRepository,
        sceneEvidenceRepository: deps.sceneEvidenceRepository,
        aiSuggestionProvider,
        now
      },
      projectId
    );
    reply.send(result);
  });

  app.get("/api/projects/:projectId/mapping-suggestions", async (request, reply) => {
    const user = await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const aiSuggestionProvider = await resolveAiSuggestionProviderForUser(
      { userAiProviderRepository: deps.userAiProviderRepository, credentialsEncryptionKey: deps.credentialsEncryptionKey },
      user.id
    );
    const result = await listMappingSuggestions(
      {
        projectRepository: deps.projectRepository,
        executionPlanRepository: deps.executionPlanRepository,
        mappingSuggestionRepository: deps.mappingSuggestionRepository,
        sceneEvidenceRepository: deps.sceneEvidenceRepository,
        aiSuggestionProvider
      },
      projectId
    );
    reply.send(result);
  });

  app.post("/api/projects/:projectId/mapping-suggestions/:suggestionId/accept", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId, suggestionId } = suggestionParamsSchema.parse(request.params);
    const body = acceptMappingSuggestionRequestSchema.parse(request.body);
    const result = await acceptMappingSuggestion(
      {
        executionPlanRepository: deps.executionPlanRepository,
        assetRepository: deps.assetRepository,
        mappingSuggestionRepository: deps.mappingSuggestionRepository,
        now
      },
      projectId,
      suggestionId,
      body.baseRevision
    );
    reply.send(result);
  });

  app.post("/api/projects/:projectId/mapping-suggestions/:suggestionId/reject", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId, suggestionId } = suggestionParamsSchema.parse(request.params);
    const result = await rejectMappingSuggestion({ mappingSuggestionRepository: deps.mappingSuggestionRepository, now }, projectId, suggestionId);
    reply.send(result);
  });

  app.post("/api/projects/:projectId/mapping-suggestions/accept-batch", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = batchAcceptMappingSuggestionsRequestSchema.parse(request.body);
    const result = await batchAcceptMappingSuggestions(
      {
        executionPlanRepository: deps.executionPlanRepository,
        assetRepository: deps.assetRepository,
        mappingSuggestionRepository: deps.mappingSuggestionRepository,
        now
      },
      projectId,
      body.suggestionIds,
      body.baseRevision
    );
    reply.send(result);
  });
}
