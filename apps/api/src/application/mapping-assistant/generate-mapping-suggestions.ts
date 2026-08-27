import { randomUUID } from "node:crypto";
import { aiSuggestionProposalBatchSchema, type ListMappingSuggestionsResponse } from "@dyo/schemas";
import { ExecutionPlanNotFoundError, ProjectNotFoundError } from "../../errors/app-error.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import type { WorkMapRepository } from "../../domain/work-map/types.js";
import type { MappingSuggestionRepository, NewMappingSuggestion } from "../../domain/mapping-suggestion/types.js";
import type { SceneEvidenceRepository } from "../../domain/scene-evidence/types.js";
import type { MappingEvidenceBundle } from "../../domain/mapping-evidence/types.js";
import { buildEvidenceBundles } from "../../domain/mapping-evidence/build-evidence-bundles.js";
import { buildSceneEvidenceAvailability } from "../../domain/mapping-evidence/scene-evidence-availability.js";
import { matchDeterministic } from "../../domain/mapping-suggestion/deterministic-matcher.js";
import { SuggestionsNotConfiguredError, type AiSuggestionProvider } from "./ai-suggestion-provider.js";
import { toMappingSuggestionDto } from "./mapping-suggestion-dto-mapper.js";

export interface GenerateMappingSuggestionsDeps {
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  assetRepository: AssetRepository;
  workMapRepository: WorkMapRepository;
  mappingSuggestionRepository: MappingSuggestionRepository;
  sceneEvidenceRepository: SceneEvidenceRepository;
  aiSuggestionProvider: AiSuggestionProvider;
  now: () => Date;
}

function targetKey(bundle: MappingEvidenceBundle): string {
  return `${bundle.scenePlanId}::${bundle.mappingId ?? ""}`;
}

/**
 * Runs deterministic evidence matching over every currently-unresolved
 * mapping target (mapping-assistant phase section 4), then - only for
 * targets deterministic matching could not resolve - asks the configured
 * AI provider (section 5). Never sends work deterministic matching
 * already resolved to the AI provider. If the provider is not configured,
 * the system remains fully usable: deterministic suggestions are still
 * persisted and returned, `aiAvailable: false` tells the caller AI simply
 * did not run this time - never surfaced as a request failure. A genuine
 * (not "not configured") provider error is NOT swallowed - it is a real
 * bug and propagates normally.
 */
export async function generateMappingSuggestions(
  deps: GenerateMappingSuggestionsDeps,
  projectId: string
): Promise<ListMappingSuggestionsResponse> {
  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }
  const plan = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (!plan) {
    throw new ExecutionPlanNotFoundError(projectId);
  }

  const assets = await deps.assetRepository.listByProjectId(projectId);
  const workMap = await deps.workMapRepository.findCurrentByProjectId(projectId);

  // Only evidence captured against this exact plan's own source SHA is ever
  // treated as current FACT - a compatible record from a different SHA (an
  // older or newer .aep revision) is never silently substituted (evidence-
  // persistence phase section 3).
  const compatibleEvidence = await deps.sceneEvidenceRepository.listCompatibleByProject(
    projectId,
    plan.sourceProjectSha256
  );
  const latestEvidence = await deps.sceneEvidenceRepository.listLatestByProject(projectId);
  const sceneEvidenceByCompositionId = new Map(compatibleEvidence.map((row) => [row.manifestCompositionId, row.response]));
  const sceneEvidenceAvailability = buildSceneEvidenceAvailability(plan.scenePlans, compatibleEvidence, latestEvidence);

  const bundles = buildEvidenceBundles({
    scenePlans: plan.scenePlans,
    assets,
    workMap,
    brandInputs: project.brandInputs,
    sceneEvidenceByCompositionId
  });

  const now = deps.now();
  const persisted: NewMappingSuggestion[] = [];
  const unresolvedBundles: MappingEvidenceBundle[] = [];

  for (const bundle of bundles) {
    const match = matchDeterministic(bundle);
    if (match) {
      persisted.push({
        id: randomUUID(),
        projectId,
        scenePlanId: bundle.scenePlanId,
        mappingId: bundle.mappingId,
        source: "DETERMINISTIC",
        ...match
      });
    } else {
      unresolvedBundles.push(bundle);
    }
  }

  const aiAvailable = deps.aiSuggestionProvider.isConfigured();
  if (aiAvailable && unresolvedBundles.length > 0) {
    let raw: unknown;
    try {
      raw = await deps.aiSuggestionProvider.suggest(unresolvedBundles);
    } catch (error) {
      // isConfigured() said yes, so a SuggestionsNotConfiguredError here would mean the two drifted out of sync - still degrade honestly rather than fail the whole request, but any OTHER error is a real bug and propagates.
      if (error instanceof SuggestionsNotConfiguredError) {
        raw = { proposals: [] };
      } else {
        throw error;
      }
    }
    const parsed = aiSuggestionProposalBatchSchema.safeParse(Array.isArray(raw) ? { proposals: raw } : raw);
    // A provider response that fails strict schema validation produces nothing usable this round - never partially trusted, never persisted (section 14: "malformed response rejected").
    if (parsed.success) {
      const byKey = new Map(unresolvedBundles.map((bundle) => [targetKey(bundle), bundle]));
      for (const proposal of parsed.data.proposals) {
        const bundle = byKey.get(`${proposal.scenePlanId}::${proposal.mappingId ?? ""}`);
        if (!bundle) {
          // The provider proposed a target this call never asked about - never trusted, silently skipped rather than persisted against an unrelated scene/mapping.
          continue;
        }
        const assetIsReal = proposal.suggestedAssetId === null || assets.some((asset) => asset.id === proposal.suggestedAssetId);
        persisted.push({
          id: randomUUID(),
          projectId,
          scenePlanId: proposal.scenePlanId,
          mappingId: proposal.mappingId,
          source: "AI",
          suggestedClassification: proposal.suggestedClassification,
          // Never a fabricated/arbitrary/cross-project id - re-validated against this exact project's real Asset Catalog before ever being persisted (section 10).
          suggestedAssetId: assetIsReal ? proposal.suggestedAssetId : null,
          suggestedText: proposal.suggestedText,
          suggestedAssetTimestamp: proposal.suggestedAssetTimestamp,
          suggestedFinalDuration: proposal.suggestedFinalDuration,
          confidence: proposal.confidence,
          reasoning: proposal.reasoning,
          evidenceRefs: proposal.evidenceRefs,
          unresolvedReason: assetIsReal ? null : "The AI provider proposed an asset id that is not in this project's Asset Catalog - discarded",
          requiresHumanReview: true,
          conflictsWithWorkMap: bundle.workMapEntry !== null
        });
      }
    }
  }

  await Promise.all(persisted.map((row) => deps.mappingSuggestionRepository.upsertPending(row, now)));
  const all = await deps.mappingSuggestionRepository.listByProjectId(projectId);

  return { suggestions: all.map(toMappingSuggestionDto), aiAvailable, sceneEvidenceAvailability };
}
