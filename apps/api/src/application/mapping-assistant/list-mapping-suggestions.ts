import type { ListMappingSuggestionsResponse } from "@dyo/schemas";
import { ProjectNotFoundError } from "../../errors/app-error.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { MappingSuggestionRepository } from "../../domain/mapping-suggestion/types.js";
import type { SceneEvidenceRepository } from "../../domain/scene-evidence/types.js";
import { buildSceneEvidenceAvailability } from "../../domain/mapping-evidence/scene-evidence-availability.js";
import type { AiSuggestionProvider } from "./ai-suggestion-provider.js";
import { toMappingSuggestionDto } from "./mapping-suggestion-dto-mapper.js";

export interface ListMappingSuggestionsDeps {
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  mappingSuggestionRepository: MappingSuggestionRepository;
  sceneEvidenceRepository: SceneEvidenceRepository;
  aiSuggestionProvider: AiSuggestionProvider;
}

/** Read-only - never runs matching itself (see generate-mapping-suggestions.ts for that). Every status (PENDING/ACCEPTED/REJECTED) is returned so the dashboard can show recent history alongside open suggestions. */
export async function listMappingSuggestions(deps: ListMappingSuggestionsDeps, projectId: string): Promise<ListMappingSuggestionsResponse> {
  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }
  const records = await deps.mappingSuggestionRepository.listByProjectId(projectId);

  // A project may not have an execution plan yet - the evidence-status
  // indicator is then simply empty, never an error, since there are no
  // scenes yet to report a status for.
  const plan = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  const compatibleEvidence = plan
    ? await deps.sceneEvidenceRepository.listCompatibleByProject(projectId, plan.sourceProjectSha256)
    : [];
  const latestEvidence = await deps.sceneEvidenceRepository.listLatestByProject(projectId);
  const sceneEvidenceAvailability = buildSceneEvidenceAvailability(plan?.scenePlans ?? [], compatibleEvidence, latestEvidence);

  return {
    suggestions: records.map(toMappingSuggestionDto),
    aiAvailable: deps.aiSuggestionProvider.isConfigured(),
    sceneEvidenceAvailability
  };
}
