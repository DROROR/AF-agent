import { updateWorkMapRequestSchema, type TemplateManifest, type WorkMap } from "@dyo/schemas";
import { AiWorkMapNotConfiguredError, NoUsableWorkMapDraftError, ProjectNotFoundError } from "../../errors/app-error.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import type { WorkMapRepository } from "../../domain/work-map/types.js";
import type { SceneEvidenceRepository } from "../../domain/scene-evidence/types.js";
import type { AiEditableLayer, AiWorkMapProvider } from "./ai-work-map-provider.js";
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

/**
 * Real production failure, 2026-10-02: a single-master template has ONE
 * candidate scene and 76 nested compositions, and every one of the 77 was
 * being handed to the AI as "a scene to plan". It dutifully began an entry
 * for each, the answer ran into the output limit part-way through, and the
 * client got "Could not create a video plan" after a 90-second wait.
 *
 * Only two kinds of composition are worth an entry: one the inspection
 * itself called a scene, and one that directly holds a layer the client can
 * actually change. Everything else is the template's own plumbing
 * (transitions, mattes, precomposed shapes) - nothing a client can ask for
 * lives there. Manifest order is kept, and each composition says which
 * editable layers it holds so the plan can be written against real slots.
 *
 * A manifest with no scenes and no placeholders at all falls back to every
 * composition - the previous behaviour - rather than sending nothing.
 */
/** Enough of a text layer's own wording for the AI to see how long a line the template was designed for - never the whole of a long paragraph. */
const CURRENT_TEXT_PREVIEW_LENGTH = 120;

/**
 * A plan row may name one layer (targetPlaceholderId). The AI is told to
 * copy that id verbatim, and this never takes its word for it: an id that
 * is not a real placeholder of this template is dropped to null (the row
 * stays, as a note about its composition), and a real one has its
 * composition corrected to the layer's own, so a row can never claim a
 * layer while pointing at a different composition.
 */
export function reconcileTargetPlaceholder<T extends { sourceCompositionId: string | null; targetPlaceholderId?: string | null | undefined }>(entry: T, manifest: TemplateManifest): T {
  if (entry.targetPlaceholderId === undefined || entry.targetPlaceholderId === null) {
    return entry;
  }
  for (const scene of manifest.scenes) {
    const placeholder = scene.placeholders.find((candidate) => candidate.placeholderId === entry.targetPlaceholderId);
    if (placeholder) {
      return { ...entry, sourceCompositionId: placeholder.compositionId };
    }
  }
  return { ...entry, targetPlaceholderId: null };
}

export function compositionsWorthPlanning(manifest: TemplateManifest): Array<{ id: string; name: string; editableLayers: AiEditableLayer[] }> {
  const editableLayersByComposition = new Map<string, AiEditableLayer[]>();
  const sceneCompositionIds = new Set<string>();
  for (const scene of manifest.scenes) {
    sceneCompositionIds.add(scene.compositionId);
    for (const placeholder of scene.placeholders) {
      const layers = editableLayersByComposition.get(placeholder.compositionId) ?? [];
      // Was a bare "Text A (text)" label - enough to know a slot exists, not
      // enough for a plan row to say WHICH slot it means.
      // layers.push(`${placeholder.layerName} (${placeholder.placeholderType})`);
      const currentText = typeof placeholder.originalText === "string" && placeholder.originalText.trim() !== "" ? placeholder.originalText.slice(0, CURRENT_TEXT_PREVIEW_LENGTH) : null;
      layers.push({ placeholderId: placeholder.placeholderId, name: placeholder.layerName, kind: placeholder.placeholderType, currentText });
      editableLayersByComposition.set(placeholder.compositionId, layers);
    }
  }

  const relevant = manifest.compositions.filter((composition) => sceneCompositionIds.has(composition.compositionId) || editableLayersByComposition.has(composition.compositionId));
  const chosen = relevant.length > 0 ? relevant : manifest.compositions;
  return chosen.map((composition) => ({
    id: composition.compositionId,
    name: composition.name,
    editableLayers: editableLayersByComposition.get(composition.compositionId) ?? []
  }));
}

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

  const compositions = compositionsWorthPlanning(project.manifest);

  const providerStart = Date.now();
  const result = await deps.aiWorkMapProvider.draftWorkMap({
    instructions,
    // Was every composition in the project - see compositionsWorthPlanning.
    // compositions: project.manifest.compositions.map((composition) => ({ id: composition.compositionId, name: composition.name })),
    compositions,
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
      validEntries.push(reconcileTargetPlaceholder(parsed.data, project.manifest));
    } else {
      rejectedCount += 1;
    }
  }

  deps.log?.info(
    {
      projectId,
      compositionCount: project.manifest.compositions.length,
      plannedCompositionCount: compositions.length,
      candidateAssetCount: assets.length,
      providerDurationMs,
      providerStopReason: result.metadata.stopReason,
      providerInputTokens: result.metadata.inputTokens,
      providerOutputTokens: result.metadata.outputTokens,
      websiteFetchAttempts: result.metadata.webFetch?.attempts ?? null,
      websiteFetchErrorCodes: result.metadata.webFetch?.errorCodes ?? null,
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
