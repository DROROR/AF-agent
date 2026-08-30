import { randomUUID } from "node:crypto";
import { aiSuggestionProposalSchema, type ListMappingSuggestionsResponse } from "@dyo/schemas";
import { ExecutionPlanNotFoundError, NoUsableMappingSuggestionsError, ProjectNotFoundError } from "../../errors/app-error.js";
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
import { SuggestionsNotConfiguredError, type AiSuggestionMetadata, type AiSuggestionProvider } from "./ai-suggestion-provider.js";
import { toMappingSuggestionDto } from "./mapping-suggestion-dto-mapper.js";

/**
 * Structural, pino/Fastify-compatible logging seam - deliberately not a
 * hard dependency on Fastify's own logger type, since application-layer
 * code in this codebase never otherwise depends on the web framework.
 * Optional: when omitted, the funnel simply logs nothing (see
 * routes/mapping-assistant.ts, which passes request.log here).
 */
export interface MappingSuggestionsFunnelLogger {
  info(payload: Record<string, unknown>, message: string): void;
}

export interface GenerateMappingSuggestionsDeps {
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  assetRepository: AssetRepository;
  workMapRepository: WorkMapRepository;
  mappingSuggestionRepository: MappingSuggestionRepository;
  sceneEvidenceRepository: SceneEvidenceRepository;
  aiSuggestionProvider: AiSuggestionProvider;
  now: () => Date;
  log?: MappingSuggestionsFunnelLogger;
}

function targetKey(bundle: MappingEvidenceBundle): string {
  return `${bundle.scenePlanId}::${bundle.mappingId ?? ""}`;
}

/** Never trusts the provider's own response shape - a non-array/non-object `proposals` degrades to an empty list here rather than throwing, so a malformed outer shape is just zero raw proposals to iterate, not a crash. */
function extractRawProposals(raw: unknown): unknown[] {
  const normalized = Array.isArray(raw) ? { proposals: raw } : raw;
  if (typeof normalized === "object" && normalized !== null && "proposals" in normalized && Array.isArray((normalized as { proposals: unknown }).proposals)) {
    return (normalized as { proposals: unknown[] }).proposals;
  }
  return [];
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
 *
 * Real production bug, 2026-08-30: a real Anthropic call could return a
 * large batch of proposals where every single one failed a single
 * whole-array Zod parse (aiSuggestionProposalSchema is .strict(), and
 * z.array() fails the entire array on one bad item), silently discarding
 * ALL of them - including otherwise-valid ones - with zero logging, while
 * the route still returned 200. Each raw proposal is now validated
 * (aiSuggestionProposalSchema.safeParse) and reference-checked (does it
 * name a target this call actually asked about) INDIVIDUALLY: one bad
 * proposal is rejected and counted, never taking down its siblings. A
 * real batch that produced at least one raw proposal but ended with
 * nothing usable now throws NoUsableMappingSuggestionsError (422) instead
 * of silently returning an empty, 200 "success".
 *
 * Observability-only addition, 2026-08-30: a real ~62s Anthropic call for
 * a 106-target project returned rawProposalCount: 0 - a genuine, legitimate
 * empty result under the rule above, but with no way to tell a clean
 * "nothing to propose" apart from a MAX_TOKENS truncation before this.
 * The provider's own non-sensitive completion metadata (stop_reason,
 * input/output token counts - never the response content itself) is now
 * carried back and logged alongside the funnel, so the next real
 * occurrence answers that question without calling the provider again.
 * This does NOT change generation behavior, max_tokens, the tool schema,
 * or the empty-result rule above - it only makes the existing behavior
 * observable.
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
  let deterministicProposalCount = 0;

  for (const bundle of bundles) {
    const match = matchDeterministic(bundle);
    if (match) {
      deterministicProposalCount += 1;
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
  let providerDurationMs = 0;
  let rawProposalCount = 0;
  let domainValidProposalCount = 0;
  let domainRejectedProposalCount = 0;
  let referenceValidProposalCount = 0;
  let referenceRejectedProposalCount = 0;
  const rejectedIssues: Array<{ index: number; path: string; code: string }> = [];

  let providerMetadata: AiSuggestionMetadata = { stopReason: null, inputTokens: null, outputTokens: null };

  if (aiAvailable && unresolvedBundles.length > 0) {
    let rawProposalsValue: unknown;
    const providerStart = Date.now();
    try {
      const result = await deps.aiSuggestionProvider.suggest(unresolvedBundles);
      rawProposalsValue = result.proposals;
      providerMetadata = result.metadata;
    } catch (error) {
      // isConfigured() said yes, so a SuggestionsNotConfiguredError here would mean the two drifted out of sync - still degrade honestly rather than fail the whole request, but any OTHER error is a real bug and propagates.
      if (error instanceof SuggestionsNotConfiguredError) {
        rawProposalsValue = { proposals: [] };
      } else {
        throw error;
      }
    } finally {
      providerDurationMs = Date.now() - providerStart;
    }

    const rawProposals = extractRawProposals(rawProposalsValue);
    rawProposalCount = rawProposals.length;
    const byKey = new Map(unresolvedBundles.map((bundle) => [targetKey(bundle), bundle]));

    rawProposals.forEach((rawProposal, index) => {
      // Every raw proposal is validated INDIVIDUALLY - a single malformed
      // item (out-of-range confidence, a zero/negative duration, an empty
      // required id, ...) is rejected and counted, never discarding the
      // rest of a real batch alongside it. Never coerced/repaired - a
      // rejected proposal is simply not persisted, exactly as the model
      // produced it or not at all.
      const parsedProposal = aiSuggestionProposalSchema.safeParse(rawProposal);
      if (!parsedProposal.success) {
        domainRejectedProposalCount += 1;
        for (const issue of parsedProposal.error.issues) {
          rejectedIssues.push({ index, path: issue.path.join("."), code: issue.code });
        }
        return;
      }
      domainValidProposalCount += 1;

      const proposal = parsedProposal.data;
      const bundle = byKey.get(`${proposal.scenePlanId}::${proposal.mappingId ?? ""}`);
      if (!bundle) {
        // The provider proposed a target this call never asked about - never trusted, silently skipped rather than persisted against an unrelated scene/mapping.
        referenceRejectedProposalCount += 1;
        return;
      }
      referenceValidProposalCount += 1;

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
    });
  }

  deps.log?.info(
    {
      projectId,
      eligibleTargetCount: unresolvedBundles.length,
      deterministicProposalCount,
      providerDurationMs,
      providerStopReason: providerMetadata.stopReason,
      providerInputTokens: providerMetadata.inputTokens,
      providerOutputTokens: providerMetadata.outputTokens,
      rawProposalCount,
      domainValidProposalCount,
      domainRejectedProposalCount,
      referenceValidProposalCount,
      referenceRejectedProposalCount,
      finalPersistableCount: referenceValidProposalCount,
      persistedCount: persisted.length,
      // Capped defensively - never unbounded, even though a real batch is
      // itself bounded (currently one call per generate request). Never
      // the invalid raw value itself - path/code only.
      rejectedIssues: rejectedIssues.slice(0, 50)
    },
    "mapping-suggestions generate: AI proposal funnel"
  );

  // Only a real batch that produced at least one raw proposal but ended
  // with nothing usable counts as this failure - a provider that validly
  // returns zero proposals (it genuinely had nothing to suggest) is a
  // different, legitimate outcome and must not be treated as an error.
  if (rawProposalCount > 0 && referenceValidProposalCount === 0) {
    throw new NoUsableMappingSuggestionsError();
  }

  await Promise.all(persisted.map((row) => deps.mappingSuggestionRepository.upsertPending(row, now)));
  const all = await deps.mappingSuggestionRepository.listByProjectId(projectId);

  return { suggestions: all.map(toMappingSuggestionDto), aiAvailable, sceneEvidenceAvailability };
}
