"use client";

import { useState, type ReactElement } from "react";
import {
  sceneEvidenceResponseSchema,
  type AnimatablePropertyFact,
  type LayerTransform,
  type LayerTransformFact,
  type OutputLayoutProposal,
  type OutputLayoutProposalEntry,
  type OutputLayoutRefusalReason,
  type ScenePlanEntry
} from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useProjectGuidance } from "./ProjectGuidanceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
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
 * The native 1080x1920 output was unreachable from the dashboard until
 * 2026-09-24: the edit operation (SET_REELS_LAYOUT), the worker build
 * (BUILD_REELS_COMPOSITION) and the persisted `reelsLayout` all existed and
 * were tested, and no screen anywhere asked a human for the one thing they
 * need - so that end-to-end run rendered Landscape only and the database had
 * never held a single Reels composition (docs/ACCEPTANCE.md).
 *
 * WHAT CHANGED ON 2026-09-27, AND WHAT DID NOT. This card used to state, in
 * its own copy, that "nothing here measures, calculates, suggests or
 * pre-fills a coordinate" - and it really did not. Two hand-made vertical
 * layouts were produced from those empty fields and both were wrong in the
 * two ways plain arithmetic is always wrong: positions mapped into the new
 * frame with the scales left alone (1920-wide artwork sliced off both
 * edges), then everything scaled to the new width (the background shrank
 * with it and the top 38% of the video came out black). Those are facts
 * about measured geometry, not something a person should be left to work out
 * per layer in their head, so the fields now ARRIVE FILLED IN from
 * `proposeOutputLayout` (packages/schemas/src/output-layout-proposal.ts),
 * computed from each layer's real `sourceRectAtTime` box and never from a
 * layer's name.
 *
 * The invariant this screen is built on is therefore narrower than it was,
 * and stronger: NO VALUE IS EVER APPLIED THAT THE REVIEWER DID NOT APPROVE.
 * The system measures and proposes; the person reads, changes anything they
 * disagree with, and saves; execution uses ONLY what was saved
 * (layerTransformSchema's own doc comment, and CLAUDE.md's Runtime AI rule).
 * Concretely:
 *
 *   - Every pre-filled X, Y and scale stays fully editable, and what is sent
 *     is whatever stands in the fields at the moment Save is pressed - the
 *     proposal has no path of its own into the plan.
 *   - A layer the measurement cannot safely adapt is REFUSED with its
 *     reason and listed as such, never silently dropped and never guessed at.
 *   - An ABSENT proposal means "this scene was not measured" - said out loud,
 *     with `reelsLayoutProposalFailureReason` when the worker gave one - and
 *     the card falls back to exactly its previous empty-field behaviour. It
 *     never means "there is nothing to do here".
 *   - The composition name is typed, never generated from the scene's name.
 *   - The frame diagram plots the numbers that are in the fields right now,
 *     proposed or edited. It is a mirror of the current state, never a
 *     separate suggestion.
 *
 * The one other value this screen resolves for itself is
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

/**
 * The measured proposal turned into exactly what the form holds: one string
 * per field, already ticked. This is the ONLY place a proposed number enters
 * this card, and it enters as form state - editable, overwritable, and read
 * back out of the fields when Save is pressed. There is no second path from
 * a proposal into the plan.
 */
function prefilledEntries(proposal: OutputLayoutProposal): Record<number, LayerEntryFormState> {
  const prefilled: Record<number, LayerEntryFormState> = {};
  for (const entry of proposal.proposals) {
    prefilled[entry.layerIndex] = {
      include: true,
      positionX: String(entry.positionX),
      positionY: String(entry.positionY),
      scalePercent: String(entry.scalePercent)
    };
  }
  return prefilled;
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
 * Why a layer cannot be given a target here, made visible while the reviewer
 * is choosing rather than discovered as a failed job hours later.
 *
 * ONE ANSWER, NOT TWO. When a measured proposal is present it is the only
 * authority: a layer it proposed numbers for is offerable, a layer it refused
 * carries that refusal and its typed reason, and this function computes
 * nothing of its own. Re-deriving a second verdict from the same facts is how
 * a screen ends up disagreeing with the rule that actually runs - the
 * proposal's own refusal order (a parented AND keyframed layer is reported as
 * parented) would not survive being recomputed here.
 *
 * Only with NO proposal at all - an older worker - does the local fallback
 * apply, and then it is deliberately the SAME pair of refusals this card has
 * always made:
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
export type LayerRefusal =
  | { source: "LOCAL"; kind: "ANIMATED" | "UNREADABLE" }
  | { source: "PROPOSAL"; reason: OutputLayoutRefusalReason; detail: string }
  | null;

export function layerRefusalFor(layer: LayerTransformFact, proposal: OutputLayoutProposal | null = null): LayerRefusal {
  if (proposal !== null) {
    if (proposal.proposals.some((entry) => entry.layerIndex === layer.layerIndex)) {
      return null;
    }
    const refused = proposal.refusals.find((entry) => entry.layerIndex === layer.layerIndex);
    if (refused) {
      return { source: "PROPOSAL", reason: refused.reason, detail: refused.detail };
    }
    // A layer the proposal mentions in neither list is a shape this
    // dashboard has never seen. Falling through to the local rule keeps the
    // layer visible and offerable rather than inventing a verdict for it.
  }
  if (layer.position === null || layer.scale === null) {
    return { source: "LOCAL", kind: "UNREADABLE" };
  }
  if (layer.position.animated || layer.scale.animated) {
    return { source: "LOCAL", kind: "ANIMATED" };
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

/** Which plan edit the confirmation dialog is currently holding back, or null when nothing is pending. */
type PendingPlanEdit = "save" | "clear" | null;

export function ReelsLayoutCard(): ReactElement | null {
  const { t } = useLocale();
  const { project, plan, applyEdit } = useProjectWorkspaceContext();
  // The SAME derivation every other screen reads (ProjectGuidanceProvider) -
  // this card never works out for itself what an edit would cost.
  const { planEditImpact } = useProjectGuidance();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [scenePlanId, setScenePlanId] = useState("");
  const [reelsCompositionName, setReelsCompositionName] = useState("");
  const [layerFacts, setLayerFacts] = useState<LayerTransformFact[] | null>(null);
  /**
   * The measured proposal that came back with the SAME layer read - kept
   * beside the facts it was derived from, and null whenever the worker sent
   * none. Null is "this scene was not measured", never "nothing to do": the
   * card says so on screen and falls back to empty fields.
   */
  const [layoutProposal, setLayoutProposal] = useState<OutputLayoutProposal | null>(null);
  const [proposalFailureReason, setProposalFailureReason] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<number, LayerEntryFormState>>({});
  const [isReadingLayers, setIsReadingLayers] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingPlanEdit>(null);

  if (!project) {
    return null;
  }

  const projectId = project.project.projectId;
  const scenes: ScenePlanEntry[] = (plan?.plan.scenePlans ?? []).filter((scene) => scene.use);
  const selectedScene = scenes.find((scene) => scene.id === scenePlanId) ?? null;
  const savedLayout = selectedScene?.reelsLayout ?? null;
  const worker = resolveProjectWorker(dashboardStatus?.workers ?? null, "INSPECT_SCENE_EVIDENCE", project.project.sourceWorkerId);
  /**
   * The scene's own composition as the manifest records it - shown beside
   * the fixed 1080x1920 target so the reviewer can see the relationship they
   * are working across. A fact that was already loaded; never a calculation,
   * and deliberately null rather than assumed when the manifest has no entry.
   */
  const sourceComposition = selectedScene ? project.manifest.compositions.find((c) => c.compositionId === selectedScene.manifestCompositionId) ?? null : null;
  const warning = t.projectWorkspace.renderSettings.reelsLayout.planEditWarning;

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

  /** The measured proposal for one layer, or null - a lookup on layerIndex, never a guess and never a match on a name. */
  function proposalEntryFor(layerIndex: number): OutputLayoutProposalEntry | null {
    return layoutProposal?.proposals.find((entry) => entry.layerIndex === layerIndex) ?? null;
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
   * diagnostics already use, and no new endpoint) and reports what After
   * Effects really holds - position, scale, real bounding box, and whether
   * any of it is keyframed. Nothing is mutated and nothing is saved.
   *
   * The same response carries the measured layout proposal derived from
   * those very facts, which is what fills the fields in below. Filling a
   * field in is not applying it: the reviewer reads, edits and saves, and
   * only the saved values are ever executed.
   */
  async function handleReadLayers(): Promise<void> {
    if (!worker || !selectedScene) {
      return;
    }
    setIsReadingLayers(true);
    setReadError(null);
    setLayerFacts(null);
    setLayoutProposal(null);
    setProposalFailureReason(null);
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
      // Absent on an older worker, which must not break the read - the card
      // then behaves exactly as it did before, with empty fields and a line
      // saying the scene was not measured.
      const proposal = parsed.data.reelsLayoutProposal ?? null;
      setLayoutProposal(proposal);
      setProposalFailureReason(parsed.data.reelsLayoutProposalFailureReason ?? null);
      setEntries(proposal === null ? {} : prefilledEntries(proposal));
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
      if (!entry.include || layerRefusalFor(layer, layoutProposal) !== null) {
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

  const includedCount = (layerFacts ?? []).filter((layer) => entryFor(layer.layerIndex).include && layerRefusalFor(layer, layoutProposal) === null).length;
  const layerTransforms = buildLayerTransforms();
  const isIncomplete = includedCount > 0 && layerTransforms === null;
  const outsideFrame = (layerTransforms ?? []).some(
    (transform) => transform.positionX < 0 || transform.positionX > REELS_WIDTH_PX || transform.positionY < 0 || transform.positionY > REELS_HEIGHT_PX
  );
  const canSave = selectedScene !== null && reelsCompositionName.trim() !== "" && layerTransforms !== null && !isSaving;
  const inlineWarning = planEditImpact.requiresConfirmation ? <p className="reels-layout-refusal">{warning.inlineNotice}</p> : null;

  /**
   * REAL 2026-09-27 INCIDENT. Saving a Reels layout is a plan edit, and a
   * plan edit returns the plan to DRAFT and orphans the live execution
   * session with both of its preview approvals. The operator hit exactly
   * that: an approved plan and a completed session were destroyed by this
   * button, and every approval had to be given again.
   *
   * So the edit now stops here FIRST, and only when there is genuinely
   * something to lose (plan-edit-impact.ts). A DRAFT plan with no session
   * saves straight through with no dialog at all - a confirmation nobody
   * needs is how people learn to click past the one they do.
   */
  function requestSave(): void {
    if (planEditImpact.requiresConfirmation) {
      setPendingEdit("save");
      return;
    }
    void performSave();
  }

  function requestClear(): void {
    if (planEditImpact.requiresConfirmation) {
      setPendingEdit("clear");
      return;
    }
    void performClear();
  }

  function confirmPendingEdit(): void {
    const pending = pendingEdit;
    setPendingEdit(null);
    if (pending === "save") {
      void performSave();
    } else if (pending === "clear") {
      void performClear();
    }
  }

  async function performSave(): Promise<void> {
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

  async function performClear(): Promise<void> {
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
                setLayoutProposal(null);
                setProposalFailureReason(null);
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
              {inlineWarning}
              <div className="overview-actions">
                <Button variant="secondary" disabled={isSaving} disabledReason={t.projectWorkspace.disabledReason.working} onClick={requestClear}>
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
                <Button
                  variant="secondary"
                  disabled={!worker || isReadingLayers}
                  disabledReason={isReadingLayers ? t.projectWorkspace.disabledReason.working : t.projectWorkspace.disabledReason.noWorker}
                  onClick={() => void handleReadLayers()}
                >
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
              {/*
                Measured or not measured, said out loud. An absent proposal
                is never allowed to look like an empty form the reviewer was
                always meant to fill in from nothing - it is a scene that was
                not measured, with the worker's own reason when there is one.
              */}
              {layoutProposal === null ? (
                <div className="reels-layout-unmeasured">
                  <p>
                    <strong>{t.projectWorkspace.renderSettings.reelsLayout.proposalMissingTitle}</strong>
                  </p>
                  <p>
                    {proposalFailureReason === null
                      ? t.projectWorkspace.renderSettings.reelsLayout.proposalMissingUnknown
                      : t.projectWorkspace.renderSettings.reelsLayout.proposalMissingWithReason(proposalFailureReason)}
                  </p>
                </div>
              ) : (
                <>
                  <p>
                    <strong>{t.projectWorkspace.renderSettings.reelsLayout.proposalTitle}</strong>
                  </p>
                  <p>{t.projectWorkspace.renderSettings.reelsLayout.proposalSummary(layoutProposal.proposals.length)}</p>
                  <p>{t.projectWorkspace.renderSettings.reelsLayout.valuesAreYours}</p>
                </>
              )}
              <p>
                {sourceComposition
                  ? t.projectWorkspace.renderSettings.reelsLayout.sourceFrameFact(sourceComposition.widthPx, sourceComposition.heightPx)
                  : t.projectWorkspace.renderSettings.reelsLayout.sourceFrameUnknown}
              </p>
              <p>{t.projectWorkspace.renderSettings.reelsLayout.scaleRelationshipNote}</p>
              {layerFacts.map((layer) => {
                const refusal = layerRefusalFor(layer, layoutProposal);
                // A layer the measurement refused is reported in one place -
                // the list below, with its reason - rather than half here
                // and half there.
                if (refusal !== null && refusal.source === "PROPOSAL") {
                  return null;
                }
                const proposed = proposalEntryFor(layer.layerIndex);
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
                    {/* Why the filled-in numbers are what they are - a measured
                        verdict about this layer's own geometry, so the reviewer
                        can judge them instead of merely accepting them. */}
                    {proposed === null ? null : (
                      <p className="reels-layout-role" data-role={proposed.role}>
                        {proposed.role === "BACKGROUND"
                          ? t.projectWorkspace.renderSettings.reelsLayout.proposalRoleBackground
                          : t.projectWorkspace.renderSettings.reelsLayout.proposalRoleContent}
                      </p>
                    )}
                    {refusal !== null && refusal.kind === "ANIMATED" ? (
                      <p className="reels-layout-refusal">{t.projectWorkspace.renderSettings.reelsLayout.layerAnimatedRefusal}</p>
                    ) : null}
                    {refusal !== null && refusal.kind === "UNREADABLE" ? (
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

              {/*
                Every layer the measurement could not adapt, with the reason
                in the reader's own language. Never silently dropped: a layer
                missing from this screen is a gap discovered by eye in the
                finished video, or as a failed job hours later.
              */}
              {layoutProposal === null || layoutProposal.refusals.length === 0 ? null : (
                <div className="reels-layout-refusals">
                  <p>
                    <strong>{t.projectWorkspace.renderSettings.reelsLayout.refusalsTitle}</strong>
                  </p>
                  <p>{t.projectWorkspace.renderSettings.reelsLayout.refusalsHint}</p>
                  <ul>
                    {layoutProposal.refusals.map((refusal) => (
                      <li key={refusal.layerIndex}>
                        <strong>{t.projectWorkspace.renderSettings.reelsLayout.layerLegend(refusal.layerIndex, refusal.layerName)}</strong>{" "}
                        {/* The typed reason is what a reader sees; `detail` is
                            English prose from the worker, a fallback only. */}
                        {t.projectWorkspace.renderSettings.reelsLayout.refusalReason[refusal.reason] ?? refusal.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p>
                <strong>{t.projectWorkspace.renderSettings.reelsLayout.framePreviewTitle}</strong>
              </p>
              <p>{t.projectWorkspace.renderSettings.reelsLayout.framePreviewHint}</p>
              {/* Plots the numbers that are in the fields RIGHT NOW - filled
                  in from the measurement, then changed by the reviewer. A
                  mirror of the current state, never a second suggestion. The
                  measured role only marks the background apart from the rest;
                  it moves no marker. */}
              <div className="reels-layout-frame" role="img" aria-label={t.projectWorkspace.renderSettings.reelsLayout.framePreviewAlt}>
                {(layerTransforms ?? []).map((transform) => {
                  const proposed = proposalEntryFor(transform.layerIndex);
                  return (
                    <span
                      key={transform.layerIndex}
                      className="reels-layout-frame__marker"
                      data-role={proposed === null ? undefined : proposed.role}
                      style={{
                        insetInlineStart: `${(transform.positionX / REELS_WIDTH_PX) * 100}%`,
                        top: `${(transform.positionY / REELS_HEIGHT_PX) * 100}%`
                      }}
                    >
                      {transform.layerIndex}
                    </span>
                  );
                })}
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
              {inlineWarning}
              <div className="overview-actions">
                <Button
                  variant="primary"
                  disabled={!canSave}
                  disabledReason={
                    isSaving
                      ? t.projectWorkspace.disabledReason.working
                      : selectedScene === null
                        ? t.projectWorkspace.disabledReason.noSceneChosen
                        : t.projectWorkspace.disabledReason.noLayoutChanges
                  }
                  onClick={requestSave}
                >
                  {isSaving ? t.projectWorkspace.savingLabel : t.projectWorkspace.renderSettings.reelsLayout.saveAction}
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {/*
        The gate itself. It lists ONLY consequences that are genuinely real
        right now - see plan-edit-impact.ts - and when the session could not
        be read it says that instead of listing nothing, because "we found no
        session" and "we could not look" are different facts and only one of
        them means it is safe to press Save.
      */}
      <Dialog
        open={pendingEdit !== null}
        onClose={() => setPendingEdit(null)}
        title={pendingEdit === "clear" ? warning.clearTitle : warning.saveTitle}
      >
        <p>{warning.intro}</p>
        <ul>
          {planEditImpact.losesPlanApproval ? <li>{warning.losesPlanApproval}</li> : null}
          {planEditImpact.losesSession ? <li>{warning.losesSession}</li> : null}
          {planEditImpact.losesFirstPreviewApproval ? <li>{warning.losesFirstPreviewApproval}</li> : null}
          {planEditImpact.losesFullPreviewApproval ? <li>{warning.losesFullPreviewApproval}</li> : null}
          {planEditImpact.sessionUnknown ? <li>{warning.sessionUnknown}</li> : null}
        </ul>
        <p>{warning.advice}</p>
        <div className="edit-drawer-actions">
          <Button variant="secondary" onClick={() => setPendingEdit(null)}>
            {warning.cancelAction}
          </Button>
          <Button variant="danger" onClick={confirmPendingEdit}>
            {pendingEdit === "clear" ? warning.confirmClearAction : warning.confirmSaveAction}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
