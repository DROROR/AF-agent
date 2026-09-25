"use client";

import { useState, type ReactElement } from "react";
import { sceneEvidenceResponseSchema, type AnimatablePropertyFact, type LayerTransform, type LayerTransformFact, type ScenePlanEntry } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";
import { dispatchJob, fetchJobStatus } from "../lib/projects-api-client";
import { resolveProjectWorker } from "../lib/resolve-project-worker";

/**
 * THE NATIVE REELS LAYOUT SURFACE.
 *
 * Until today the native 1080x1920 output was unreachable from the dashboard:
 * the edit operation (SET_REELS_LAYOUT), the worker build
 * (BUILD_REELS_COMPOSITION) and the persisted `reelsLayout` all existed and
 * were tested, and no screen anywhere asked a human for the one thing they
 * need - so the 2026-09-24 end-to-end run rendered Landscape only and the
 * database had never held a single Reels composition (docs/ACCEPTANCE.md).
 *
 * The values are a HUMAN decision, and this screen is built around that rule
 * rather than around convenience:
 *
 *   - Nothing here measures, calculates, suggests or pre-fills a coordinate.
 *     Every X, Y and scale that reaches the plan was typed by the reviewer.
 *     The source composition's own current values are shown BESIDE the fields
 *     as context and are never copied into them, because a value the reviewer
 *     did not choose is exactly what layerTransformSchema's own doc comment
 *     forbids ("no AI guessing coordinates at execution time").
 *   - The composition name is typed, never generated from the scene's name.
 *   - The frame diagram plots only the numbers the reviewer has entered. It
 *     is a mirror, not a suggestion.
 *
 * The one value this screen does resolve for itself is
 * `manifestPlaceholderId`: looked up from the project's OWN manifest by the
 * composition and layer index the scan reported - a recorded fact about which
 * placeholder lives on that layer, not a coordinate and not a judgement. A
 * layer the manifest records nothing for is sent as `null`, which the schema
 * explicitly allows (a decorative layer need not be a placeholder at all).
 */

/**
 * The Reels frame is fixed: the worker's own JSX resizes the duplicate to
 * exactly 1080x1920 and accepts no caller-supplied dimension (see
 * buildBuildReelsCompositionScript). These two numbers are the frame every
 * coordinate on this screen is expressed in - they are the output format
 * CLAUDE.md requires, never anything read from a template.
 */
const REELS_WIDTH_PX = 1080;
const REELS_HEIGHT_PX = 1920;

const POLL_INTERVAL_MS = 2_000;
/** ~2 minutes, the same bound SlotReviewPanel uses for its own read-only capture round trip. */
const MAX_POLL_ATTEMPTS = 60;

interface LayerEntryFormState {
  include: boolean;
  positionX: string;
  positionY: string;
  scalePercent: string;
}

function emptyEntry(): LayerEntryFormState {
  return { include: false, positionX: "", positionY: "", scalePercent: "" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** AE reports position/scale as a 2- or 3-element array (or a plain number for a rotation-like property) - shown exactly as reported, never reduced to a single "the" value. */
function formatPropertyValue(fact: AnimatablePropertyFact | null): string | null {
  if (fact === null) {
    return null;
  }
  const value = fact.currentValue;
  const parts = Array.isArray(value) ? value : [value];
  return parts.map((part) => String(Math.round(part * 1000) / 1000)).join(", ");
}

/**
 * Why a layer cannot be given a target here - the two real refusals, made
 * visible while the reviewer is choosing rather than discovered as a failed
 * job hours later:
 *
 *   - `ANIMATED`: the build refuses to write a static transform over
 *     keyframed position/scale rather than destroying that animation
 *     (buildBuildReelsCompositionScript's own guard, and CLAUDE.md's
 *     "preserve original template animation/structure"). Leaving such a layer
 *     out is not a loss - an untargeted layer keeps its own animation in the
 *     duplicate.
 *   - `UNREADABLE`: the scan could not read this layer's position or scale at
 *     all (a camera layer genuinely has no scale), so there is nothing to
 *     target.
 */
type LayerRefusal = "ANIMATED" | "UNREADABLE" | null;

export function layerRefusalFor(layer: LayerTransformFact): LayerRefusal {
  if (layer.position === null || layer.scale === null) {
    return "UNREADABLE";
  }
  if (layer.position.animated || layer.scale.animated) {
    return "ANIMATED";
  }
  return null;
}

/** A finite number the reviewer actually typed, or null - an empty or unparseable field is never quietly treated as 0. */
function typedNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ReelsLayoutCard(): ReactElement | null {
  const { t } = useLocale();
  const { project, plan, applyEdit } = useProjectWorkspaceContext();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [scenePlanId, setScenePlanId] = useState("");
  const [reelsCompositionName, setReelsCompositionName] = useState("");
  const [layerFacts, setLayerFacts] = useState<LayerTransformFact[] | null>(null);
  const [entries, setEntries] = useState<Record<number, LayerEntryFormState>>({});
  const [isReadingLayers, setIsReadingLayers] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!project) {
    return null;
  }

  const projectId = project.project.projectId;
  const scenes: ScenePlanEntry[] = (plan?.plan.scenePlans ?? []).filter((scene) => scene.use);
  const selectedScene = scenes.find((scene) => scene.id === scenePlanId) ?? null;
  const savedLayout = selectedScene?.reelsLayout ?? null;
  const worker = resolveProjectWorker(dashboardStatus?.workers ?? null, "INSPECT_SCENE_EVIDENCE", project.project.sourceWorkerId);

  /** The manifest's own record of which placeholder sits on a given layer of this scene's composition - a lookup, never an inference. */
  function manifestPlaceholderIdFor(scene: ScenePlanEntry, layerIndex: number): string | null {
    for (const manifestScene of project?.manifest.scenes ?? []) {
      for (const placeholder of manifestScene.placeholders) {
        if (placeholder.compositionId === scene.manifestCompositionId && placeholder.layerIndex === layerIndex) {
          return placeholder.placeholderId;
        }
      }
    }
    return null;
  }

  function entryFor(layerIndex: number): LayerEntryFormState {
    return entries[layerIndex] ?? emptyEntry();
  }

  function updateEntry(layerIndex: number, patch: Partial<LayerEntryFormState>): void {
    setEntries((current) => ({ ...current, [layerIndex]: { ...(current[layerIndex] ?? emptyEntry()), ...patch } }));
  }

  /**
   * Read-only: dispatches the EXISTING generic layer-transform scan against
   * this scene's own composition (the same capability the Render Settings
   * diagnostics already use) and reports what After Effects really holds -
   * position, scale, and whether either is keyframed. Nothing is mutated,
   * nothing is saved, and the result is never turned into a suggested value.
   */
  async function handleReadLayers(): Promise<void> {
    if (!worker || !selectedScene) {
      return;
    }
    setIsReadingLayers(true);
    setReadError(null);
    setLayerFacts(null);
    setEntries({});
    const dispatched = await dispatchJob({
      operation: "INSPECT_SCENE_EVIDENCE",
      workerId: worker.workerId,
      projectId,
      scenePlanId: selectedScene.id,
      previewTimingDiscoverCompositionId: selectedScene.manifestCompositionId,
      previewTimingDescribeLayerTransforms: true
    });
    if (!dispatched.ok) {
      setIsReadingLayers(false);
      setReadError(dispatched.message);
      return;
    }
    // Asks first and waits afterwards: a job the worker has already finished by
    // the time this returns is reported at once rather than after an idle
    // interval nobody is waiting for.
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      const status = await fetchJobStatus(dispatched.data.jobId);
      if (!status.ok) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      if (status.data.status === "FAILED" || status.data.status === "CANCELLED") {
        setIsReadingLayers(false);
        setReadError(status.data.error?.message ?? status.data.status);
        return;
      }
      if (status.data.status !== "SUCCEEDED") {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      setIsReadingLayers(false);
      const parsed = sceneEvidenceResponseSchema.safeParse(status.data.result);
      if (!parsed.success) {
        setReadError(t.projectWorkspace.renderSettings.reelsLayout.readUnexpectedShape);
        return;
      }
      if (!parsed.data.layerTransformFacts) {
        setReadError(parsed.data.layerTransformFactsFailureReason ?? t.projectWorkspace.renderSettings.reelsLayout.readNoLayers);
        return;
      }
      setLayerFacts(parsed.data.layerTransformFacts);
      return;
    }
    setIsReadingLayers(false);
    setReadError(t.projectWorkspace.renderSettings.reelsLayout.readTimedOut);
  }

  /** Exactly what the reviewer ticked and typed, in layer order - never a layer they did not include, and never a field they left empty. */
  function buildLayerTransforms(): LayerTransform[] | null {
    if (!selectedScene || !layerFacts) {
      return null;
    }
    const transforms: LayerTransform[] = [];
    for (const layer of layerFacts) {
      const entry = entryFor(layer.layerIndex);
      if (!entry.include || layerRefusalFor(layer) !== null) {
        continue;
      }
      const positionX = typedNumber(entry.positionX);
      const positionY = typedNumber(entry.positionY);
      const scalePercent = typedNumber(entry.scalePercent);
      if (positionX === null || positionY === null || scalePercent === null || scalePercent <= 0) {
        return null;
      }
      transforms.push({
        layerIndex: layer.layerIndex,
        manifestPlaceholderId: manifestPlaceholderIdFor(selectedScene, layer.layerIndex),
        positionX,
        positionY,
        scalePercent
      });
    }
    return transforms.length === 0 ? null : transforms;
  }

  const includedCount = (layerFacts ?? []).filter((layer) => entryFor(layer.layerIndex).include && layerRefusalFor(layer) === null).length;
  const layerTransforms = buildLayerTransforms();
  const isIncomplete = includedCount > 0 && layerTransforms === null;
  const outsideFrame = (layerTransforms ?? []).some(
    (transform) => transform.positionX < 0 || transform.positionX > REELS_WIDTH_PX || transform.positionY < 0 || transform.positionY > REELS_HEIGHT_PX
  );
  const canSave = selectedScene !== null && reelsCompositionName.trim() !== "" && layerTransforms !== null && !isSaving;

  async function handleSave(): Promise<void> {
    const transforms = buildLayerTransforms();
    if (!selectedScene || transforms === null || reelsCompositionName.trim() === "") {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    const result = await applyEdit([
      {
        type: "SET_REELS_LAYOUT",
        scenePlanId: selectedScene.id,
        reelsCompositionName: reelsCompositionName.trim(),
        layerTransforms: transforms
      }
    ]);
    setIsSaving(false);
    if (!result.ok) {
      setSaveError(result.message ?? null);
    }
  }

  async function handleClear(): Promise<void> {
    if (!selectedScene) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    const result = await applyEdit([{ type: "CLEAR_REELS_LAYOUT", scenePlanId: selectedScene.id }]);
    setIsSaving(false);
    if (!result.ok) {
      setSaveError(result.message ?? null);
    }
  }

  return (
    <Card className="overview-section">
      <CardHeader title={t.projectWorkspace.renderSettings.reelsLayout.title} />
      <p>{t.projectWorkspace.renderSettings.reelsLayout.description}</p>
      {scenes.length === 0 ? (
        <EmptyState
          title={t.projectWorkspace.renderSettings.reelsLayout.noScenesTitle}
          description={t.projectWorkspace.renderSettings.reelsLayout.noScenesDescription}
        />
      ) : (
        <>
          <Field label={t.projectWorkspace.renderSettings.reelsLayout.sceneLabel} htmlFor="reels-layout-scene">
            <Select
              id="reels-layout-scene"
              value={scenePlanId}
              onChange={(event) => {
                // A different scene is a different composition: every layer
                // fact and every typed number belongs to the old one.
                setScenePlanId(event.target.value);
                setLayerFacts(null);
                setEntries({});
                setReadError(null);
                setSaveError(null);
              }}
            >
              <option value="">{t.projectWorkspace.renderSettings.reelsLayout.scenePlaceholderOption}</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.compositionName}
                </option>
              ))}
            </Select>
          </Field>

          {savedLayout === null ? null : (
            <div className="reels-layout-saved">
              <p>
                <strong>{t.projectWorkspace.renderSettings.reelsLayout.savedTitle}</strong>
              </p>
              <p>{t.projectWorkspace.renderSettings.reelsLayout.savedName(savedLayout.reelsCompositionName)}</p>
              <ul>
                {savedLayout.layerTransforms.map((transform) => (
                  <li key={transform.layerIndex}>
                    {t.projectWorkspace.renderSettings.reelsLayout.savedEntry(
                      transform.layerIndex,
                      transform.positionX,
                      transform.positionY,
                      transform.scalePercent
                    )}
                  </li>
                ))}
              </ul>
              <p>{t.projectWorkspace.renderSettings.reelsLayout.savedNote}</p>
              <div className="overview-actions">
                <Button variant="secondary" disabled={isSaving} onClick={() => void handleClear()}>
                  {t.projectWorkspace.renderSettings.reelsLayout.clearAction}
                </Button>
              </div>
            </div>
          )}

          {selectedScene === null ? null : (
            <>
              <p>{t.projectWorkspace.renderSettings.reelsLayout.readLayersHint}</p>
              {!worker ? <EmptyState title={t.jobDispatch.noWorkerTitle} description={t.jobDispatch.noWorkerDescription} /> : null}
              {readError ? <ErrorState title={t.projectWorkspace.renderSettings.reelsLayout.readFailedTitle} description={readError} /> : null}
              <div className="overview-actions">
                <Button variant="secondary" disabled={!worker || isReadingLayers} onClick={() => void handleReadLayers()}>
                  {isReadingLayers
                    ? t.projectWorkspace.renderSettings.reelsLayout.readingLayers
                    : t.projectWorkspace.renderSettings.reelsLayout.readLayersAction}
                </Button>
              </div>
            </>
          )}

          {layerFacts === null ? null : layerFacts.length === 0 ? (
            <EmptyState
              title={t.projectWorkspace.renderSettings.reelsLayout.noLayersTitle}
              description={t.projectWorkspace.renderSettings.reelsLayout.noLayersDescription}
            />
          ) : (
            <>
              <p>
                <strong>{t.projectWorkspace.renderSettings.reelsLayout.layersTitle}</strong>
              </p>
              <p>{t.projectWorkspace.renderSettings.reelsLayout.valuesAreYours}</p>
              {layerFacts.map((layer) => {
                const refusal = layerRefusalFor(layer);
                const entry = entryFor(layer.layerIndex);
                const position = formatPropertyValue(layer.position);
                const scale = formatPropertyValue(layer.scale);
                return (
                  <fieldset key={layer.layerIndex} className="reels-layout-layer" data-blocked={refusal === null ? "false" : "true"}>
                    <legend>{t.projectWorkspace.renderSettings.reelsLayout.layerLegend(layer.layerIndex, layer.layerName)}</legend>
                    <p>
                      {position === null || scale === null
                        ? t.projectWorkspace.renderSettings.reelsLayout.currentUnknown
                        : t.projectWorkspace.renderSettings.reelsLayout.currentValues(position, scale)}
                    </p>
                    {layer.threeDLayer ? <p>{t.projectWorkspace.renderSettings.reelsLayout.layerIsThreeD}</p> : null}
                    {refusal === "ANIMATED" ? <p className="reels-layout-refusal">{t.projectWorkspace.renderSettings.reelsLayout.layerAnimatedRefusal}</p> : null}
                    {refusal === "UNREADABLE" ? (
                      <p className="reels-layout-refusal">{t.projectWorkspace.renderSettings.reelsLayout.layerUnreadableRefusal}</p>
                    ) : null}
                    {refusal !== null ? null : (
                      <>
                        <label className="reels-layout-include" htmlFor={`reels-layout-include-${layer.layerIndex}`}>
                          <input
                            id={`reels-layout-include-${layer.layerIndex}`}
                            type="checkbox"
                            checked={entry.include}
                            onChange={(event) => updateEntry(layer.layerIndex, { include: event.target.checked })}
                          />
                          <span>{t.projectWorkspace.renderSettings.reelsLayout.includeLabel}</span>
                        </label>
                        {!entry.include ? null : (
                          <div className="reels-layout-fields">
                            <Field
                              label={t.projectWorkspace.renderSettings.reelsLayout.positionXLabel}
                              htmlFor={`reels-layout-x-${layer.layerIndex}`}
                            >
                              <Input
                                id={`reels-layout-x-${layer.layerIndex}`}
                                type="number"
                                step="1"
                                value={entry.positionX}
                                onChange={(event) => updateEntry(layer.layerIndex, { positionX: event.target.value })}
                              />
                            </Field>
                            <Field
                              label={t.projectWorkspace.renderSettings.reelsLayout.positionYLabel}
                              htmlFor={`reels-layout-y-${layer.layerIndex}`}
                            >
                              <Input
                                id={`reels-layout-y-${layer.layerIndex}`}
                                type="number"
                                step="1"
                                value={entry.positionY}
                                onChange={(event) => updateEntry(layer.layerIndex, { positionY: event.target.value })}
                              />
                            </Field>
                            <Field
                              label={t.projectWorkspace.renderSettings.reelsLayout.scaleLabel}
                              htmlFor={`reels-layout-scale-${layer.layerIndex}`}
                            >
                              <Input
                                id={`reels-layout-scale-${layer.layerIndex}`}
                                type="number"
                                min="0"
                                step="1"
                                value={entry.scalePercent}
                                onChange={(event) => updateEntry(layer.layerIndex, { scalePercent: event.target.value })}
                              />
                            </Field>
                          </div>
                        )}
                      </>
                    )}
                  </fieldset>
                );
              })}

              <p>
                <strong>{t.projectWorkspace.renderSettings.reelsLayout.framePreviewTitle}</strong>
              </p>
              <p>{t.projectWorkspace.renderSettings.reelsLayout.framePreviewHint}</p>
              {/* Plots only what the reviewer typed - a mirror of their own
                  numbers inside the fixed frame, never a proposed placement. */}
              <div className="reels-layout-frame" role="img" aria-label={t.projectWorkspace.renderSettings.reelsLayout.framePreviewAlt}>
                {(layerTransforms ?? []).map((transform) => (
                  <span
                    key={transform.layerIndex}
                    className="reels-layout-frame__marker"
                    style={{
                      insetInlineStart: `${(transform.positionX / REELS_WIDTH_PX) * 100}%`,
                      top: `${(transform.positionY / REELS_HEIGHT_PX) * 100}%`
                    }}
                  >
                    {transform.layerIndex}
                  </span>
                ))}
              </div>
              {outsideFrame ? <p className="reels-layout-refusal">{t.projectWorkspace.renderSettings.reelsLayout.outsideFrameWarning}</p> : null}
              {isIncomplete ? <p className="reels-layout-refusal">{t.projectWorkspace.renderSettings.reelsLayout.incompleteWarning}</p> : null}

              <Field
                label={t.projectWorkspace.renderSettings.reelsLayout.compositionNameLabel}
                htmlFor="reels-layout-composition-name"
                hint={t.projectWorkspace.renderSettings.reelsLayout.compositionNameHint}
              >
                <Input
                  id="reels-layout-composition-name"
                  value={reelsCompositionName}
                  onChange={(event) => setReelsCompositionName(event.target.value)}
                />
              </Field>
              {saveError ? <ErrorState title={t.projectWorkspace.renderSettings.reelsLayout.saveFailedTitle} description={saveError} /> : null}
              <div className="overview-actions">
                <Button variant="primary" disabled={!canSave} onClick={() => void handleSave()}>
                  {isSaving ? t.projectWorkspace.savingLabel : t.projectWorkspace.renderSettings.reelsLayout.saveAction}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}
