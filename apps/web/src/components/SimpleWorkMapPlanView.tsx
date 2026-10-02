"use client";

import type { ReactElement } from "react";
import type { AssetDto, TemplateManifest, WorkMapAiSummary, WorkMapEntry } from "@dyo/schemas";
import { assetFileUrl } from "../lib/projects-api-client";
import {
  computeSimpleAiPlanSummary,
  filterWorkMapEntriesForSimpleMode,
  groupLayerPlanEntries,
  hasAnyEditablePlaceholder,
  hasClientFacingInstructions,
  isTopLevelPlanEntry,
  orderPlanEntriesForSimpleMode,
  sceneLevelPlanEntries,
  type LayerPlanGroup
} from "../lib/simple-work-map-plan";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";

function resolveSceneName(entry: WorkMapEntry, sceneNameByCompositionId: Map<string, string>, noContent: string): string {
  if (entry.sourceCompositionId) {
    return sceneNameByCompositionId.get(entry.sourceCompositionId) ?? entry.sourceReference ?? entry.sourceCompositionId;
  }
  return entry.sourceReference ?? noContent;
}

function resolveAssetLabel(entry: WorkMapEntry, assetById: Map<string, AssetDto>): string | null {
  if (!entry.desiredAssetId) {
    return null;
  }
  const asset = assetById.get(entry.desiredAssetId);
  return asset ? (asset.label ?? asset.originalFilename) : entry.desiredAssetId;
}

/** Exported for direct, isolated testing of the real-vs-honest-fallback thumbnail contract (never reachable as fake production data - see previewUrl's own doc comment). */
export interface PlanCardProps {
  entry: WorkMapEntry;
  index: number;
  total: number;
  sceneNameByCompositionId: Map<string, string>;
  assetById: Map<string, AssetDto>;
  /**
   * A real, already-captured scene frame URL - or null when none exists
   * yet. NEVER a fabricated/decorative placeholder image (final Simple
   * Mode UX pass, section 3/4): at this stage (before an execution plan
   * exists) the existing scene-evidence-preview capability
   * (INSPECT_SCENE_EVIDENCE -> scene_evidence_previews, see
   * use-scene-preview-queue.ts/SceneCard.tsx's own real usage on the
   * Scenes tab) is keyed by scenePlanId, which does not exist yet - see
   * this feature's own report for the exact backend piece that would be
   * needed to reuse it here. Always null today; the prop exists so this
   * component is ready to render a real frame the moment one becomes
   * available, without ever inventing a fake one meanwhile.
   */
  previewUrl: string | null;
  onEditPlan: () => void;
  /**
   * Set for a nested composition shown because it holds editable content:
   * the card is then titled with the composition's own name instead of an
   * ordinal, and the redundant "Template composition:" line is dropped.
   * Omitted for a real top-level scene, which keeps "Main Scene"/"Scene N".
   */
  nestedPartName?: string;
}

export function PlanCard({ entry, index, total, sceneNameByCompositionId, assetById, previewUrl, onEditPlan, nestedPartName }: PlanCardProps): ReactElement {
  const { t } = useLocale();
  const s = t.workMapTab.planPreview.simple;
  // The raw AE composition name ("!Render", "Pre-comp 3", ...) is real,
  // useful metadata (shown subtly below the title, and Advanced Mode's own
  // raw grid still shows it as the primary column) - but it is never a
  // client-friendly PRIMARY title. "Main Scene" / "Scene N" is a plain
  // ordinal derived only from real, already-filtered card position - never
  // a name heuristic, never used to decide scene hierarchy (that stays
  // exactly filterWorkMapEntriesForSimpleMode's isNestedOnlyReferenced
  // check, unchanged).
  const compositionName = resolveSceneName(entry, sceneNameByCompositionId, t.workMapTab.planPreview.noContent);
  // const displayTitle = total === 1 ? s.sceneTitleMain : s.sceneTitleNumbered(index + 1);
  const displayTitle = nestedPartName ?? (total === 1 ? s.sceneTitleMain : s.sceneTitleNumbered(index + 1));
  const assetLabel = resolveAssetLabel(entry, assetById);

  return (
    <Card className="plan-card">
      <div className="plan-card__header">
        <h3>{displayTitle}</h3>
        {nestedPartName === undefined ? <p className="plan-card__composition-name">{s.templateCompositionLabel(compositionName)}</p> : null}
      </div>

      {previewUrl ? (
        <img src={previewUrl} alt={displayTitle} className="plan-card__thumbnail" />
      ) : (
        <div className="plan-card__thumbnail-placeholder" aria-hidden="true">
          <span>{s.thumbnailPlaceholder}</span>
        </div>
      )}

      <div className="plan-card__checklist">
        <p className="plan-card__checklist-title">{s.cardPlanTitle}</p>
        <ul>
          <li>{s.cardPlanPreserveAnimation}</li>
          <li>{s.cardPlanPreserveTiming}</li>
          <li>{s.cardPlanKeepConnected}</li>
          <li>{s.cardPlanReplaceSafe}</li>
        </ul>
      </div>

      {/*
        Real, plain-language AI instruction text (e.g. "No uploaded assets
        available to map. Keep original template content unchanged.") shown
        verbatim - never rewritten/fabricated - as the client-facing home
        for this content (live QA follow-up). This replaces the old raw
        "Advanced details" technical list in Simple Mode, which exposed
        exactly the Work Map UUID / composition ID / desiredAssetId values
        Simple Mode must never show a client; Advanced Mode's own list is
        untouched and still shows those raw fields.
      */}
      {hasClientFacingInstructions(entry) ? (
        <p className="plan-card__note">
          <strong>{s.aiNoteLabel}</strong> {entry.instructions}
        </p>
      ) : null}

      <dl className="plan-card__facts">
        <div>
          <dt>{s.replaceWithLabel}</dt>
          <dd>{assetLabel ?? s.noReplacementPlanned}</dd>
        </div>
        <div>
          <dt>{s.textLabel}</dt>
          <dd>{entry.desiredText ?? s.noEditableText}</dd>
        </div>
        <div>
          <dt>{s.timingLabel}</dt>
          <dd>{entry.desiredDurationSeconds !== null ? s.durationSuffix(entry.desiredDurationSeconds) : s.usesOriginalTiming}</dd>
        </div>
      </dl>

      <div className="plan-card__actions">
        <Button size="sm" variant="ghost" onClick={onEditPlan}>
          {s.editPlanAction}
        </Button>
      </div>
    </Card>
  );
}

/**
 * One composition's layer rows as a single short card: the layer's own
 * name on the left, what goes on it on the right. Real complaint,
 * 2026-10-02: eleven cards each repeating the same four-line "AI plans
 * to" checklist and "Scene preview not generated yet" box buried the only
 * lines that mattered. This card carries nothing but those lines.
 */
export function LayerPlanCard({ group, assetById, projectId }: { group: LayerPlanGroup; assetById: Map<string, AssetDto>; projectId?: string }): ReactElement {
  const { t } = useLocale();
  const s = t.workMapTab.planPreview.simple;
  return (
    <Card className="layer-plan-card">
      <h4 className="layer-plan-card__title">{group.compositionName}</h4>
      <dl className="layer-plan-card__rows">
        {group.rows.map((row) => {
          const asset = row.entry.desiredAssetId ? assetById.get(row.entry.desiredAssetId) : undefined;
          return (
            <div key={row.entry.id} className="layer-plan-card__row">
              <dt>{row.layerName}</dt>
              {/* Was a bare value: <dd>{row.entry.desiredText ?? resolveAssetLabel(row.entry, assetById) ?? row.entry.instructions ?? "—"}</dd> */}
              <dd>
                {/* Before -> after, so what the assistant changed is visible at a glance. */}
                {row.entry.desiredText !== null && row.currentText !== null ? (
                  <span className="layer-plan-card__was">
                    <span className="layer-plan-card__was-label">{s.layerWasLabel}</span> {row.currentText}
                  </span>
                ) : null}
                {row.entry.desiredText !== null ? <strong className="layer-plan-card__now">{row.entry.desiredText}</strong> : null}
                {asset && projectId && isShowableImage(asset) ? <img className="layer-plan-card__thumb" src={assetFileUrl(projectId, asset.id)} alt={asset.label ?? asset.originalFilename} /> : null}
                {row.entry.desiredText === null ? <span>{resolveAssetLabel(row.entry, assetById) ?? row.entry.instructions ?? "—"}</span> : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

/** Only a real still image is shown as a picture - a video, audio or document asset is named, never given a broken thumbnail. */
function isShowableImage(asset: AssetDto): boolean {
  return (asset.mediaKind === "IMAGE" || asset.mediaKind === "LOGO") && asset.mimeType.startsWith("image/");
}

/**
 * "What the assistant used" - the website it read (or could not), what it
 * understood about the business, and the client's own uploaded files as
 * real pictures, each marked used or not used in this plan. Real complaint,
 * 2026-10-02: a plan appeared with no visible sign of what had been read,
 * fetched or used. Shows nothing invented: the website status comes from the
 * fetch tool's own outcome, and a file is "used" only if a plan row names it.
 */
export function AiPlanSummaryPanel({ aiSummary, assets, usedAssetIds, projectId }: { aiSummary: WorkMapAiSummary | null; assets: AssetDto[]; usedAssetIds: Set<string>; projectId: string }): ReactElement | null {
  const { t } = useLocale();
  const s = t.workMapTab.planPreview.simple;
  if (aiSummary === null && assets.length === 0) {
    return null;
  }
  return (
    <section className="ai-used">
      <h3 className="ai-used__title">{s.usedTitle}</h3>

      {aiSummary !== null && aiSummary.websiteRead !== "NOT_GIVEN" ? (
        <p className={aiSummary.websiteRead === "READ" ? "ai-used__website ai-used__website--read" : "ai-used__website ai-used__website--failed"}>
          {aiSummary.websiteRead === "READ" ? s.usedWebsiteRead(aiSummary.websiteUrl ?? "") : s.usedWebsiteFailed(aiSummary.websiteUrl ?? "")}
        </p>
      ) : null}

      {aiSummary !== null && (aiSummary.productName !== null || aiSummary.tagline !== null || aiSummary.features.length > 0 || aiSummary.tone !== null) ? (
        <dl className="ai-used__facts">
          {aiSummary.productName !== null ? (
            <div>
              <dt>{s.usedNameLabel}</dt>
              <dd>{aiSummary.productName}</dd>
            </div>
          ) : null}
          {aiSummary.tagline !== null ? (
            <div>
              <dt>{s.usedTaglineLabel}</dt>
              <dd>{aiSummary.tagline}</dd>
            </div>
          ) : null}
          {aiSummary.features.length > 0 ? (
            <div>
              <dt>{s.usedFeaturesLabel}</dt>
              <dd>
                <ul className="ai-used__chips">
                  {aiSummary.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {aiSummary.tone !== null ? (
            <div>
              <dt>{s.usedToneLabel}</dt>
              <dd>{aiSummary.tone}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {aiSummary?.notes ? <p className="ai-used__notes">{aiSummary.notes}</p> : null}

      {assets.length > 0 ? (
        <>
          <p className="ai-used__files-title">{s.usedFilesLabel}</p>
          <ul className="ai-used__files">
            {assets.map((asset) => (
              <li key={asset.id} className="ai-used__file">
                {isShowableImage(asset) ? (
                  <img src={assetFileUrl(projectId, asset.id)} alt={asset.label ?? asset.originalFilename} />
                ) : (
                  <span className="ai-used__file-kind">{asset.mediaKind}</span>
                )}
                <span className="ai-used__file-name">{asset.label ?? asset.originalFilename}</span>
                <span className={usedAssetIds.has(asset.id) ? "ai-used__badge ai-used__badge--used" : "ai-used__badge"}>{usedAssetIds.has(asset.id) ? s.usedFileUsed : s.usedFileNotUsed}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export interface SimpleWorkMapPlanViewProps {
  manifest: TemplateManifest;
  entries: WorkMapEntry[];
  assets: AssetDto[] | null;
  onEditPlan: () => void;
  /** What the assistant read and understood for this plan - null/absent for a hand-written or older plan. */
  aiSummary?: WorkMapAiSummary | null;
  /** Needed to show the client's own uploaded files as pictures. Absent: files are named, not pictured. */
  projectId?: string;
}

/**
 * Client-facing UX simplification ("CORE SIMPLE MODE RULE") - Simple
 * Mode's own view of the AI-drafted Work Map: real top-level/candidate
 * scenes only (filterWorkMapEntriesForSimpleMode, using the manifest's own
 * isNestedOnlyReferenced fact - never a raw composition/precomp row), a
 * plain-language summary, and one visual card per scene - never the flat
 * technical grid Advanced Mode still shows unchanged (see WorkMapPanel's
 * own mode branch). Every fact shown here comes from the real manifest or
 * the real Work Map entry - nothing is fabricated; an entry with no
 * content decision yet says so in plain language, never a bare "—".
 */
export function SimpleWorkMapPlanView({ manifest, entries, assets, onEditPlan, aiSummary, projectId }: SimpleWorkMapPlanViewProps): ReactElement {
  const { t } = useLocale();
  const s = t.workMapTab.planPreview.simple;

  const sceneNameByCompositionId = new Map(manifest.compositions.map((composition) => [composition.compositionId, composition.name]));
  const assetById = new Map((assets ?? []).map((asset) => [asset.id, asset]));
  // const visibleEntries = filterWorkMapEntriesForSimpleMode(entries, manifest);
  // Rows that name a layer are shown grouped, one short card per
  // composition; only the remaining scene-level rows become full cards.
  const layerGroups = groupLayerPlanEntries(entries, manifest);
  // const visibleEntries = orderPlanEntriesForSimpleMode(filterWorkMapEntriesForSimpleMode(entries, manifest), manifest);
  const visibleEntries = orderPlanEntriesForSimpleMode(filterWorkMapEntriesForSimpleMode(sceneLevelPlanEntries(entries, manifest), manifest), manifest);
  // "Scene N" numbering counts only real top-level scenes - a nested part
  // is titled by its own name and never takes a number.
  const topLevelEntries = visibleEntries.filter((entry) => isTopLevelPlanEntry(entry, manifest));
  const summary = computeSimpleAiPlanSummary(manifest);
  const showNoPlaceholdersNotice = !hasAnyEditablePlaceholder(manifest);

  return (
    <div className="plan-simple-view">
      {projectId !== undefined ? (
        <AiPlanSummaryPanel
          aiSummary={aiSummary ?? null}
          assets={assets ?? []}
          usedAssetIds={new Set(entries.map((entry) => entry.desiredAssetId).filter((id): id is string => id !== null))}
          projectId={projectId}
        />
      ) : null}

      <div className="plan-summary">
        <p className="plan-summary__found">
          <strong>{s.summaryTitle}:</strong> {s.summaryScenes(summary.mainSceneCount)}, {s.summarySupporting(summary.supportingCompositionCount)}, {s.summaryUnresolved(summary.unresolvedItemCount)}
        </p>
      </div>

      {showNoPlaceholdersNotice ? <p className="plan-summary__notice">{s.noPlaceholdersNotice}</p> : null}

      {layerGroups.length > 0 ? (
        <section className="layer-plan">
          <h3 className="layer-plan__title">{s.layerPlanTitle}</h3>
          <p className="layer-plan__hint">{s.layerPlanHint}</p>
          <div className="layer-plan__grid">
            {layerGroups.map((group) => (
              <LayerPlanCard key={group.compositionId} group={group} assetById={assetById} {...(projectId !== undefined ? { projectId } : {})} />
            ))}
          </div>
        </section>
      ) : null}

      {visibleEntries.length === 0 ? (
        layerGroups.length > 0 ? null : (
        <EmptyState title={t.workMapTab.emptyTitle} description={t.workMapTab.emptyDescription} />
        )
      ) : (
        <div className="plan-cards-grid">
          {visibleEntries.map((entry, index) => (
            <PlanCard
              key={entry.id}
              entry={entry}
              // index={index}
              // total={visibleEntries.length}
              index={isTopLevelPlanEntry(entry, manifest) ? topLevelEntries.indexOf(entry) : index}
              total={topLevelEntries.length}
              {...(isTopLevelPlanEntry(entry, manifest)
                ? {}
                : { nestedPartName: sceneNameByCompositionId.get(entry.sourceCompositionId ?? "") ?? entry.sourceReference ?? t.workMapTab.planPreview.noContent })}
              sceneNameByCompositionId={sceneNameByCompositionId}
              assetById={assetById}
              // No real scene frame is available before an execution plan
              // exists - see this component's own PlanCard doc comment.
              // Never fabricated; always the honest empty state until a
              // real capability supplies one.
              previewUrl={null}
              onEditPlan={onEditPlan}
            />
          ))}
        </div>
      )}
    </div>
  );
}
