"use client";

import type { ReactElement } from "react";
import type { AssetDto, TemplateManifest, WorkMapEntry } from "@dyo/schemas";
import { computeSimpleAiPlanSummary, filterWorkMapEntriesForSimpleMode, hasAnyEditablePlaceholder, hasClientFacingInstructions } from "../lib/simple-work-map-plan";
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
}

export function PlanCard({ entry, index, total, sceneNameByCompositionId, assetById, previewUrl, onEditPlan }: PlanCardProps): ReactElement {
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
  const displayTitle = total === 1 ? s.sceneTitleMain : s.sceneTitleNumbered(index + 1);
  const assetLabel = resolveAssetLabel(entry, assetById);

  return (
    <Card className="plan-card">
      <div className="plan-card__header">
        <h3>{displayTitle}</h3>
        <p className="plan-card__composition-name">{s.templateCompositionLabel(compositionName)}</p>
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

export interface SimpleWorkMapPlanViewProps {
  manifest: TemplateManifest;
  entries: WorkMapEntry[];
  assets: AssetDto[] | null;
  onEditPlan: () => void;
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
export function SimpleWorkMapPlanView({ manifest, entries, assets, onEditPlan }: SimpleWorkMapPlanViewProps): ReactElement {
  const { t } = useLocale();
  const s = t.workMapTab.planPreview.simple;

  const sceneNameByCompositionId = new Map(manifest.compositions.map((composition) => [composition.compositionId, composition.name]));
  const assetById = new Map((assets ?? []).map((asset) => [asset.id, asset]));
  const visibleEntries = filterWorkMapEntriesForSimpleMode(entries, manifest);
  const summary = computeSimpleAiPlanSummary(manifest);
  const showNoPlaceholdersNotice = !hasAnyEditablePlaceholder(manifest);

  return (
    <div className="plan-simple-view">
      <div className="plan-summary">
        <p className="plan-summary__found">
          <strong>{s.summaryTitle}:</strong> {s.summaryScenes(summary.mainSceneCount)}, {s.summarySupporting(summary.supportingCompositionCount)}, {s.summaryUnresolved(summary.unresolvedItemCount)}
        </p>
      </div>

      {showNoPlaceholdersNotice ? <p className="plan-summary__notice">{s.noPlaceholdersNotice}</p> : null}

      {visibleEntries.length === 0 ? (
        <EmptyState title={t.workMapTab.emptyTitle} description={t.workMapTab.emptyDescription} />
      ) : (
        <div className="plan-cards-grid">
          {visibleEntries.map((entry, index) => (
            <PlanCard
              key={entry.id}
              entry={entry}
              index={index}
              total={visibleEntries.length}
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
