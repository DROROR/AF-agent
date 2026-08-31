import { updateWorkMapRequestSchema, type WorkMap } from "@dyo/schemas";
import { AiWorkMapNotConfiguredError, NoUsableWorkMapDraftError, ProjectNotFoundError } from "../../errors/app-error.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import type { WorkMapRepository } from "../../domain/work-map/types.js";
import type { SceneEvidenceRepository } from "../../domain/scene-evidence/types.js";
import type { AiWorkMapProvider } from "./ai-work-map-provider.js";
import { updateWorkMap } from "./update-work-map.js";

/** Same structural logging seam as MappingSuggestionsFunnelLogger (generate-mapping-suggestions.ts) - optional, counts/metadata only, never raw content. */
export interface WorkMapDraftFunnelLogger {
  info(payload: Record<string, unknown>, message: string): void;
}

export interface GenerateAiWorkMapDraftDeps {
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  assetRepository: AssetRepository;
  workMapRepository: WorkMapRepository;
  sceneEvidenceRepository: SceneEvidenceRepository;
  aiWorkMapProvider: AiWorkMapProvider;
  now: () => Date;
  log?: WorkMapDraftFunnelLogger;
}

const WORK_MAP_DRAFT_ENTRY_SCHEMA = updateWorkMapRequestSchema.shape.entries.element;

/** Never trusts the provider's own response shape - a non-array/non-object `entries` degrades to an empty list here rather than throwing. */
function extractRawEntries(raw: unknown): unknown[] {
  const normalized = Array.isArray(raw) ? { entries: raw } : raw;
  if (typeof normalized === "object" && normalized !== null && "entries" in normalized && Array.isArray((normalized as { entries: unknown }).entries)) {
    return (normalized as { entries: unknown[] }).entries;
  }
  return [];
}

/**
 * "Tell AI what you want" - the AI-first Work Map entry point (video-
 * planning UX simplification, 2026-08-31). Takes the client's own free-
 * text description plus real project context (manifest compositions,
 * Asset Catalog, the project's current Work Map if any, brand inputs,
 * and any compatible scene evidence already captured) and asks the
 * configured AI provider to draft a complete Work Map.
 *
 * The result is persisted through the SAME updateWorkMap() every manual
 * edit already goes through - Work Map has always been client INTENT
 * only, never itself an approval gate (see workMapEntrySchema's own doc
 * comment in @dyo/schemas), so there is nothing further to "approve"
 * here. This function never touches the execution plan, never runs AE,
 * and never accepts/creates Mapping Assistant suggestions - it only
 * writes a new Work Map revision, exactly like a human editing the form
 * would.
 *
 * Each raw entry the provider returns is validated INDIVIDUALLY against
 * the existing updateWorkMapRequestSchema entry shape (same "one bad item
 * never discards its siblings" rule already proven necessary for Mapping
 * Assistant - see generate-mapping-suggestions.ts). A real attempt that
 * produces nothing usable (zero raw entries, or every one rejected)
 * throws NoUsableWorkMapDraftError (422) rather than silently persisting
 * an empty Work Map that looks like a successful plan.
 */
export async function generateAiWorkMapDraft(deps: GenerateAiWorkMapDraftDeps, projectId: string, instructions: string): Promise<WorkMap> {
  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  if (!deps.aiWorkMapProvider.isConfigured()) {
    throw new AiWorkMapNotConfiguredError();
  }

  const assets = await deps.assetRepository.listByProjectId(projectId);
  const currentWorkMap = await deps.workMapRepository.findCurrentByProjectId(projectId);
  const plan = await deps.executionPlanRepository.findCurrentByProjectId(projectId);

  // Scene evidence only makes sense to match against a plan's own source
  // SHA (same rule as generate-mapping-suggestions.ts) - most projects at
  // this early "tell AI what you want" stage have no plan yet, and that
  // is expected, never required.
  const compatibleEvidence = plan ? await deps.sceneEvidenceRepository.listCompatibleByProject(projectId, plan.sourceProjectSha256) : [];

  const providerStart = Date.now();
  const result = await deps.aiWorkMapProvider.draftWorkMap({
    instructions,
    compositions: project.manifest.compositions.map((composition) => ({ id: composition.compositionId, name: composition.name })),
    candidateAssets: assets.map((asset) => ({ id: asset.id, originalFilename: asset.originalFilename, label: asset.label, mediaKind: asset.mediaKind })),
    existingEntries: currentWorkMap?.entries ?? [],
    brandInputs: project.brandInputs,
    sceneEvidenceSummaries: compatibleEvidence.map((evidence) => ({ manifestCompositionId: evidence.manifestCompositionId, compositionName: evidence.response.compositionName }))
  });
  const providerDurationMs = Date.now() - providerStart;

  const rawEntries = extractRawEntries(result.entries);
  const validEntries: Array<ReturnType<typeof WORK_MAP_DRAFT_ENTRY_SCHEMA.parse>> = [];
  let rejectedCount = 0;

  for (const rawEntry of rawEntries) {
    const parsed = WORK_MAP_DRAFT_ENTRY_SCHEMA.safeParse(rawEntry);
    if (parsed.success) {
      validEntries.push(parsed.data);
    } else {
      rejectedCount += 1;
    }
  }

  deps.log?.info(
    {
      projectId,
      compositionCount: project.manifest.compositions.length,
      candidateAssetCount: assets.length,
      providerDurationMs,
      providerStopReason: result.metadata.stopReason,
      providerInputTokens: result.metadata.inputTokens,
      providerOutputTokens: result.metadata.outputTokens,
      rawEntryCount: rawEntries.length,
      validEntryCount: validEntries.length,
      rejectedEntryCount: rejectedCount
    },
    "work-map ai-draft: funnel"
  );

  if (validEntries.length === 0) {
    throw new NoUsableWorkMapDraftError();
  }

  const baseRevision = currentWorkMap?.revision ?? 0;
  return updateWorkMap({ workMapRepository: deps.workMapRepository, now: deps.now }, projectId, { baseRevision, entries: validEntries });
}
