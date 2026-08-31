import { randomUUID } from "node:crypto";
import { aiSuggestionProposalSchema, type ListMappingSuggestionsResponse } from "@dyo/schemas";
import { AiMappingBatchTruncatedError, ExecutionPlanNotFoundError, NoUsableMappingSuggestionsError, ProjectNotFoundError } from "../../errors/app-error.js";
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
import { detectWorkMapConflict } from "../../domain/mapping-suggestion/structural-classification.js";
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

/**
 * Real production bug, 2026-08-30: a single Anthropic call for 106
 * eligible targets in one project consumed its full MAX_TOKENS=8000
 * output budget (proven: providerOutputTokens 8000, stop_reason
 * "max_tokens") before completing a single valid proposal. Splitting
 * unresolved targets into fixed-size batches keeps each individual
 * provider call small enough to plausibly complete within MAX_TOKENS -
 * MAX_TOKENS itself is unchanged.
 */
export const AI_MAPPING_BATCH_SIZE = 20;

/**
 * Bounded, not unbounded Promise.all() - avoids bursting many large
 * Anthropic requests at once (rate-limit risk) while still keeping total
 * wall-clock time reasonable for the existing 180s application/proxy
 * timeout (a 106-target request now issues 6 batches of at most 20 at
 * concurrency 2, rather than 6 fully sequential slow calls).
 */
export const AI_MAPPING_BATCH_CONCURRENCY = 2;

function targetKey(bundle: MappingEvidenceBundle): string {
  return `${bundle.scenePlanId}::${bundle.mappingId ?? ""}`;
}

/**
 * Mapping-review deadlock fix (section B/G): a suggestion resolves
 * WITHOUT any human Accept/Reject click - "Keep original — Resolved",
 * never counted as Needs review or as a Safe suggestion needing a bulk-
 * accept click - exactly when it proposes NO replacement at all (every
 * content field null) and carries none of the "this still needs a human
 * look" signals (requiresHumanReview, conflictsWithWorkMap,
 * unresolvedReason). A real content assignment (even a high-confidence,
 * `requiresHumanReview: false` one, e.g. an explicit Work Map asset) is
 * NEVER resolved this way - it still requires an explicit Accept, just
 * one eligible for the existing Safe-suggestions bulk-accept path
 * (section F: "content targets remain human-controlled").
 */
function isResolvedNoOp(row: {
  suggestedAssetId: string | null;
  suggestedText: string | null;
  suggestedAssetTimestamp: number | null;
  suggestedFinalDuration: number | null;
  requiresHumanReview: boolean;
  conflictsWithWorkMap: boolean;
  unresolvedReason: string | null;
}): boolean {
  return (
    !row.requiresHumanReview &&
    !row.conflictsWithWorkMap &&
    row.unresolvedReason === null &&
    row.suggestedAssetId === null &&
    row.suggestedText === null &&
    row.suggestedAssetTimestamp === null &&
    row.suggestedFinalDuration === null
  );
}

/** Never trusts the provider's own response shape - a non-array/non-object `proposals` degrades to an empty list here rather than throwing, so a malformed outer shape is just zero raw proposals to iterate, not a crash. */
function extractRawProposals(raw: unknown): unknown[] {
  const normalized = Array.isArray(raw) ? { proposals: raw } : raw;
  if (typeof normalized === "object" && normalized !== null && "proposals" in normalized && Array.isArray((normalized as { proposals: unknown }).proposals)) {
    return (normalized as { proposals: unknown[] }).proposals;
  }
  return [];
}

/** Deterministic, order-preserving - chunk `i` always holds items `[i*size, (i+1)*size)` of the original array, never a random regrouping. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/**
 * Runs `worker` over every item with at most `concurrency` calls active
 * at once - never a single unbounded Promise.all() over the whole list.
 * Results are returned in the SAME order as `items`, regardless of which
 * one finishes first (each result is written to its own reserved slot,
 * not appended in completion order). If any `worker` call throws, that
 * rejection propagates immediately (the same way Promise.all's would) -
 * other still-in-flight workers are not cancelled (no abort plumbing
 * exists yet - see the existing, separately-tracked follow-up), but their
 * results are simply never used, since the caller unwinds via the thrown
 * error before ever reading this function's return value.
 */
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex] as T, currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}

/**
 * Runs deterministic evidence matching over every currently-unresolved
 * mapping target (mapping-assistant phase section 4), then - only for
 * targets deterministic matching could not resolve - asks the configured
 * AI provider (section 5), in fixed-size batches (see AI_MAPPING_BATCH_SIZE)
 * run at bounded concurrency (AI_MAPPING_BATCH_CONCURRENCY). Never sends
 * work deterministic matching already resolved to the AI provider. If the
 * provider is not configured, the system remains fully usable:
 * deterministic suggestions are still persisted and returned,
 * `aiAvailable: false` tells the caller AI simply did not run this time -
 * never surfaced as a request failure. A genuine (not "not configured")
 * provider error from any batch is NOT swallowed - it propagates and
 * aborts the whole request before anything is persisted.
 *
 * Real production bug, 2026-08-30: a real Anthropic call could return a
 * large batch of proposals where every single one failed a single
 * whole-array Zod parse (aiSuggestionProposalSchema is .strict(), and
 * z.array() fails the entire array on one bad item), silently discarding
 * ALL of them - including otherwise-valid ones - with zero logging, while
 * the route still returned 200. Each raw proposal (merged from every
 * batch, in original target order) is validated
 * (aiSuggestionProposalSchema.safeParse) and reference-checked (does it
 * name a target this call actually asked about) INDIVIDUALLY: one bad
 * proposal is rejected and counted, never taking down its siblings.
 *
 * Batching, 2026-08-30: proven root cause of the above - one oversized
 * request (106 targets, MAX_TOKENS=8000) was truncated mid-generation
 * (stop_reason: "max_tokens", providerOutputTokens: 8000), producing zero
 * usable proposals with no way to tell that apart from a genuine "nothing
 * to suggest" response. Each batch's own stop_reason is now checked
 * separately - a truncated batch throws AiMappingBatchTruncatedError
 * immediately (422), before anything is persisted, rather than silently
 * contributing zero proposals to what looked like a normal empty result.
 * Once no batch is truncated, a real request with eligible targets that
 * still ends with nothing usable (whether AI returned literally nothing,
 * or returned proposals that all failed domain/reference validation) now
 * throws NoUsableMappingSuggestionsError (422) instead of a silent, empty
 * 200 "success" - see that error class's own doc comment for why the
 * earlier, narrower version of this rule no longer applies once batching
 * removes the ambiguity that justified it.
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
        ...match,
        ...(isResolvedNoOp(match) ? { status: "RESOLVED" } : {})
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
  let batchCount = 0;
  const rejectedIssues: Array<{ index: number; path: string; code: string }> = [];

  if (aiAvailable && unresolvedBundles.length > 0) {
    const batches = chunk(unresolvedBundles, AI_MAPPING_BATCH_SIZE);
    batchCount = batches.length;
    const phaseStart = Date.now();

    const batchRawProposals = await mapWithConcurrency(batches, AI_MAPPING_BATCH_CONCURRENCY, async (batch, batchIndex) => {
      const batchStart = Date.now();
      let rawProposalsValue: unknown;
      let metadata: AiSuggestionMetadata = { stopReason: null, inputTokens: null, outputTokens: null };
      try {
        const result = await deps.aiSuggestionProvider.suggest(batch);
        rawProposalsValue = result.proposals;
        metadata = result.metadata;
      } catch (error) {
        // isConfigured() said yes, so a SuggestionsNotConfiguredError here would mean the two drifted out of sync - still degrade honestly rather than fail the whole request, but any OTHER error is a real bug and propagates (aborting all batches before anything is persisted).
        if (error instanceof SuggestionsNotConfiguredError) {
          rawProposalsValue = { proposals: [] };
        } else {
          throw error;
        }
      }

      const batchRaw = extractRawProposals(rawProposalsValue);
      const batchDurationMs = Date.now() - batchStart;

      deps.log?.info(
        {
          projectId,
          batchIndex,
          targetCount: batch.length,
          providerDurationMs: batchDurationMs,
          providerStopReason: metadata.stopReason,
          providerInputTokens: metadata.inputTokens,
          providerOutputTokens: metadata.outputTokens,
          rawProposalCount: batchRaw.length
        },
        "mapping-suggestions generate: AI batch"
      );

      // This batch's own output was cut off before completing - its JSON
      // cannot be trusted even if extractRawProposals happened to find
      // something parseable in it. Refuse the whole generation rather
      // than silently persisting a partial/incomplete batch's proposals
      // alongside good ones from other batches.
      if (metadata.stopReason === "max_tokens") {
        throw new AiMappingBatchTruncatedError();
      }

      return batchRaw;
    });

    providerDurationMs = Date.now() - phaseStart;

    const rawProposals = batchRawProposals.flat();
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

      // Video-planning UX simplification, 2026-08-31: a real, dangerous
      // pattern this codebase's own Mapping Assistant produced in
      // production - a low-confidence guess still forced a concrete
      // content replacement (e.g. "Phone.png -> generic uploaded image",
      // "Color -> arbitrary black") that a rushed reviewer could easily
      // accept without noticing how thin the evidence was. The system
      // prompt now asks the model to leave low-confidence targets null
      // instead of guessing, but that instruction alone is never trusted
      // by itself (same "never trust a TS type alone across a real
      // process/network boundary" rule this file already applies
      // elsewhere) - this is the enforced, server-side backstop: any
      // proposal under 0.5 confidence that still names a concrete asset
      // or text is stripped down to a plain "needs review" placeholder
      // before persistence, never silently trusted as a real suggestion.
      // Confidence/reasoning/evidenceRefs are kept as-is so "why this
      // suggestion?" stays honest about what little evidence there was.
      const isConcreteContentGuess = (assetIsReal && proposal.suggestedAssetId !== null) || (proposal.suggestedText !== null && proposal.suggestedText.trim() !== "");
      const isLowConfidenceGuess = proposal.confidence < 0.5 && isConcreteContentGuess;

      const finalSuggestedAssetId = isLowConfidenceGuess ? null : assetIsReal ? proposal.suggestedAssetId : null;
      const finalSuggestedText = isLowConfidenceGuess ? null : proposal.suggestedText;
      const finalSuggestedAssetTimestamp = isLowConfidenceGuess ? null : proposal.suggestedAssetTimestamp;
      const finalSuggestedFinalDuration = isLowConfidenceGuess ? null : proposal.suggestedFinalDuration;

      // Work Map conflict fix (section C): a real contradiction against
      // this target's own Work Map entry, never the old, over-broad
      // "the scene merely has some Work Map entry" check.
      const conflictsWithWorkMap = detectWorkMapConflict(bundle, { suggestedAssetId: finalSuggestedAssetId, suggestedText: finalSuggestedText });

      // Note on section B/F ("AI proposes no replacement -> resolved"):
      // every target reaching the AI provider is, by construction, one
      // matchDeterministic already returned null for - and Rule 2.5 there
      // (resolveKeepOriginal) already resolves EVERY structural/explicit-
      // keep-unchanged target before AI is ever consulted (see
      // deterministic-matcher.ts). So a bundle can never simultaneously
      // reach this AI branch AND have resolveKeepOriginal(bundle) true -
      // an AI-sourced proposal with no replacement is always for a
      // genuine content target the model simply had no confident evidence
      // for, which correctly stays requiresHumanReview: true (section F:
      // "if uncertain: Needs review" - never silently resolved here).

      persisted.push({
        id: randomUUID(),
        projectId,
        scenePlanId: proposal.scenePlanId,
        mappingId: proposal.mappingId,
        source: "AI",
        suggestedClassification: isLowConfidenceGuess ? null : proposal.suggestedClassification,
        // Never a fabricated/arbitrary/cross-project id - re-validated against this exact project's real Asset Catalog before ever being persisted (section 10).
        suggestedAssetId: finalSuggestedAssetId,
        suggestedText: finalSuggestedText,
        suggestedAssetTimestamp: finalSuggestedAssetTimestamp,
        suggestedFinalDuration: finalSuggestedFinalDuration,
        confidence: proposal.confidence,
        reasoning: proposal.reasoning,
        evidenceRefs: proposal.evidenceRefs,
        unresolvedReason: isLowConfidenceGuess
          ? "Needs review - not enough evidence for a confident automatic suggestion"
          : assetIsReal
            ? null
            : "The AI provider proposed an asset id that is not in this project's Asset Catalog - discarded",
        requiresHumanReview: true,
        conflictsWithWorkMap
      });
    });
  }

  deps.log?.info(
    {
      projectId,
      eligibleTargetCount: unresolvedBundles.length,
      deterministicProposalCount,
      batchSize: AI_MAPPING_BATCH_SIZE,
      batchCount,
      batchConcurrency: AI_MAPPING_BATCH_CONCURRENCY,
      providerDurationMs,
      rawProposalCount,
      domainValidProposalCount,
      domainRejectedProposalCount,
      referenceValidProposalCount,
      referenceRejectedProposalCount,
      finalPersistableCount: referenceValidProposalCount,
      persistedCount: persisted.length,
      // Capped defensively - never unbounded, even though a real batch is
      // itself bounded. Never the invalid raw value itself - path/code only.
      rejectedIssues: rejectedIssues.slice(0, 50)
    },
    "mapping-suggestions generate: AI proposal funnel"
  );

  // A real AI attempt (aiAvailable) over real eligible targets that ends
  // with nothing usable - whether every batch validly returned zero
  // proposals, or proposals came back but none survived domain/reference
  // validation - must not silently look like a successful, useful
  // generation. Never thrown when AI simply isn't configured (aiAvailable:
  // false is its own, honest, non-error outcome) or when there were no
  // eligible targets to begin with.
  if (aiAvailable && unresolvedBundles.length > 0 && referenceValidProposalCount === 0) {
    throw new NoUsableMappingSuggestionsError();
  }

  await Promise.all(persisted.map((row) => deps.mappingSuggestionRepository.upsertPending(row, now)));
  const all = await deps.mappingSuggestionRepository.listByProjectId(projectId);

  return { suggestions: all.map(toMappingSuggestionDto), aiAvailable, sceneEvidenceAvailability };
}
