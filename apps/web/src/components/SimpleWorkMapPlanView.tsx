"use client";

import type { ReactElement } from "react";
import type { AssetDto, TemplateManifest, WorkMapEntry } from "@dyo/schemas";
import { computeSimpleAiPlanSummary, filterWorkMapEntriesForSimpleMode, hasAnyEditablePlaceholder } from "../lib/simple-work-map-plan";
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

function PlanCard({ entry, sceneNameByCompositionId, assetById, onEditPlan }: {
  entry: WorkMapEntry;
  sceneNameByCompositionId: Map<string, string>;
  assetById: Map<string, AssetDto>;
  onEditPlan: () => void;
}): ReactElement {
  const { t } = useLocale();
  const s = t.workMapTab.planPreview.simple;
  const sceneName = resolveSceneName(entry, sceneNameByCompositionId, t.workMapTab.planPreview.noContent);
  const assetLabel = resolveAssetLabel(entry, assetById);

  return (
    <Card className="plan-card">
      <div className="plan-card__header">
        <h3>{sceneName}</h3>
      </div>

      <div className="plan-card__thumbnail-placeholder" aria-hidden="true">
        <span>{s.thumbnailPlaceholder}</span>
      </div>

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
 * plain-language 4-question summary, and one visual card per scene -
 * never the flat technical grid Advanced Mode still shows unchanged
 * (see WorkMapPanel's own mode branch). Every fact shown here comes from
 * the real manifest or the real Work Map entry - nothing is fabricated;
 * an entry with no content decision yet says so in plain language,
 * never a bare "—".
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
        <p className="plan-summary__plan-title">{s.planTitle}:</p>
        <ul className="plan-summary__list">
          <li>{s.planPreserve}</li>
          <li>{s.planUseMain}</li>
          <li>{s.planKeepPrecomps}</li>
          <li>{s.planReplaceSafe}</li>
        </ul>
      </div>

      {showNoPlaceholdersNotice ? <p className="plan-summary__notice">{s.noPlaceholdersNotice}</p> : null}

      {visibleEntries.length === 0 ? (
        <EmptyState title={t.workMapTab.emptyTitle} description={t.workMapTab.emptyDescription} />
      ) : (
        <div className="plan-cards-grid">
          {visibleEntries.map((entry) => (
            <PlanCard key={entry.id} entry={entry} sceneNameByCompositionId={sceneNameByCompositionId} assetById={assetById} onEditPlan={onEditPlan} />
          ))}
        </div>
      )}
    </div>
  );
}
