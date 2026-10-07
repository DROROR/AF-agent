"use client";

import type { ReactElement } from "react";
import type { AssetDto, MappingSuggestion, PlaceholderMapping } from "@dyo/schemas";
import type { RealScene } from "../lib/real-scene-grouping";
import type { ScenePreviewEntry, ScenePreviewState } from "../lib/use-scene-preview-queue";
import { assetFileUrl, sceneEvidencePreviewFileUrl } from "../lib/projects-api-client";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { BusyNotice } from "./ui/BusyNotice";
import { useLocale } from "./LocaleProvider";
import type { Tone } from "./StatusBadge";

type CardStatus = "ready" | "needsChoice" | "noChangeNeeded" | "analyzing" | "generating" | "outdated";

const STATUS_TONE: Record<CardStatus, Tone> = {
  ready: "positive",
  needsChoice: "info",
  noChangeNeeded: "positive",
  analyzing: "neutral",
  generating: "neutral",
  outdated: "negative"
};

/**
 * `hasNoMappingsToReview` distinguishes a scene that is resolved because it
 * genuinely has nothing editable (zero placeholders/mappings - the
 * approved AI plan's own "keep original" intent, see
 * compute-scene-unresolved-reasons.ts's isStructurallyResolvedWithNoMappings)
 * from a scene resolved because a real content decision was actually made.
 * Both reach approvalState READY_FOR_APPROVAL/APPROVED, but only the first
 * is a "noChangeNeeded" scene - the second is a genuine "ready" scene with
 * a real mapping behind it (live QA Blocker 3 fix, 2026-09-07). A scene
 * still stuck UNREVIEWED because of a genuine evidence/inspection FAILURE
 * (never cleared by that same fix) still falls through to "needsChoice"
 * here, unchanged - it is not resolved, so it must not look resolved.
 */
function deriveCardStatus(
  hasGenuineReview: boolean,
  previewState: ScenePreviewState,
  isStale: boolean,
  approvalState: RealScene["scenePlan"]["approvalState"],
  hasNoMappingsToReview: boolean,
  hasUndecidedHere: boolean,
  showsEverythingItOwns: boolean
): CardStatus {
  // REAL 2026-10-06 (client project 3241977f): three scene cards each said
  // "1 text here has not been decided" under a green "Ready", while "The
  // whole video" said "Needs your choice" and showed nothing to choose - it
  // owns those texts in the plan but they are drawn on the scenes' cards. A
  // badge now speaks for what its own card shows.
  if (hasGenuineReview || hasUndecidedHere) {
    return "needsChoice";
  }
  if (previewState === "checking" || previewState === "queued") {
    return "analyzing";
  }
  if (previewState === "generating") {
    return "generating";
  }
  if (isStale) {
    return "outdated";
  }
  // Only a card that shows everything its scene owns can read the scene's
  // own state as its own; otherwise what is undecided is on another card.
  if (showsEverythingItOwns && approvalState !== "READY_FOR_APPROVAL" && approvalState !== "APPROVED") {
    return "needsChoice";
  }
  return hasNoMappingsToReview ? "noChangeNeeded" : "ready";
}

// function primaryMapping(realScene: RealScene) {
//   return realScene.scenePlan.mappings.find((m) => m.selectedAssetId || m.text) ?? realScene.scenePlan.mappings[0] ?? null;
// }
/** Layer kinds that hold a picture or a clip - shown to a client as "Picture", never by the template's layer name. */
const PICTURE_KINDS: ReadonlySet<string> = new Set(["image", "video", "logo", "phone_screen"]);

function primaryMapping(mappings: readonly PlaceholderMapping[]) {
  return mappings.find((m) => m.selectedAssetId || m.text) ?? mappings[0] ?? null;
}

/**
 * "M. VISUAL PREVIEWS ARE MANDATORY", point 4/11: shows Original (a real
 * AE-captured frame) alongside Planned (an honestly-labeled browser
 * mockup built from the currently assigned asset/text) side by side when
 * BOTH exist - never presenting the mockup as if it were the real AE
 * result. Falls back to whichever ONE of the two actually exists, and to
 * a plain empty state when neither does yet.
 */
function PreviewBeforeAfter({
  projectId,
  realScene,
  previewEntry
}: {
  projectId: string;
  realScene: RealScene;
  previewEntry: ScenePreviewEntry;
}): ReactElement {
  const { t } = useLocale();
  const hasOriginal = previewEntry.preview !== null;

  if (!hasOriginal) {
    return (
      <div className="scene-card__preview">
        <p className="scene-card__preview-empty">{t.simpleScenes.noPreviewYetHint}</p>
      </div>
    );
  }

  return (
    // 2026-10-06: beside this frame the card drew a second, made-up picture -
    // the chosen file with the text in italics under it and an orange line
    // saying it was "a rough sketch". Two pictures, one of them not real, on
    // every card. The card now shows the one real frame; what goes on it is
    // listed right below, with the chosen picture as a thumbnail.
    <div className="scene-card__preview">
      <div className="scene-card__preview-pane">
        <img src={sceneEvidencePreviewFileUrl(projectId, realScene.scenePlan.id)} alt={realScene.sceneName} className="scene-card__preview-media" />
        {/* 2026-10-07: "The template, before your changes" under every one of nine frames; said once above the cards instead (SimpleScenesView). */}
        {previewEntry.isStale ? <p className="scene-card__preview-hint">{t.simpleScenes.outdatedPreviewHint}</p> : null}
      </div>
    </div>
  );
}

export interface SceneCardProps {
  projectId: string;
  realScene: RealScene;
  assets: AssetDto[] | null;
  previewEntry: ScenePreviewEntry;
  pendingSuggestions: MappingSuggestion[];
  suggestionsBusy: boolean;
  /** Opens this card's panel; with a layer id, the panel opens on that layer's own box. */
  onEdit: (focusMappingId?: string) => void;
  /** The template's own wording for a text layer, when the manifest holds it in full. Absent or null: the card names the layer instead. */
  templateTextOf?: (mapping: PlaceholderMapping) => string | null;
  onRegeneratePreview: () => void;
  onAcceptSuggestion: (suggestion: MappingSuggestion) => void;
  onRejectSuggestion: (suggestion: MappingSuggestion) => void;
  /**
   * The layers shown on THIS card - which can differ from the scene plan's
   * own mappings when a template keeps every layer under one master scene
   * (see resolveSceneMappingHomes). Absent: the scene plan's own mappings,
   * exactly as before.
   */
  cardMappings?: readonly PlaceholderMapping[];
  /**
   * Records "keep the template's text" for these text layers, and settles any
   * no-change findings about them. Absent: the older behaviour, where
   * agreeing with a finding recorded nothing on the plan.
   */
  onKeepTemplateText?: (mappingIds: string[], findings: MappingSuggestion[]) => void;
  /** Records "no text in this place" for one text layer. Absent: the choice is not offered. */
  onNoText?: (mappingId: string) => void;
  /** What this card is called for a person ("Scene 3", "Whole video") - shown above the template's own name. */
  eyebrow?: string;
  /** Applies several suggestions in ONE request. Absent: no "use all" button is offered - several single accepts fired together would each carry the same plan revision and all but the first would be refused as stale. */
  onAcceptSuggestions?: (suggestions: MappingSuggestion[]) => void;
  /**
   * Draw this card's "use" buttons quieter, because the page's one primary
   * action is somewhere else right now (2026-10-04: one primary button on
   * screen at a time - see SimpleScenesView). They work exactly the same.
   */
  quietActions?: boolean;
}

/**
 * One real, user-facing scene card (client-facing UX redesign, section
 * B/C + "M. VISUAL PREVIEWS ARE MANDATORY" + the "LIVE UX ACCEPTANCE
 * FAILED" section 6 follow-up). Never shows a raw AE layer name,
 * confidence percentage, or Worker job name in this Simple Mode view.
 * Preview generation is automatic (see use-scene-preview-queue.ts, owned
 * by the parent SimpleScenesView) - this card never dispatches on its
 * own; "Regenerate Preview" (Advanced details only) is the one manual
 * escape hatch, for a failed or stale preview.
 */
export function SceneCard({
  projectId,
  realScene,
  assets,
  previewEntry,
  pendingSuggestions,
  suggestionsBusy,
  onEdit,
  onRegeneratePreview,
  onAcceptSuggestion,
  onRejectSuggestion,
  cardMappings,
  onAcceptSuggestions,
  eyebrow,
  onKeepTemplateText,
  onNoText,
  templateTextOf,
  quietActions = false
}: SceneCardProps): ReactElement {
  const { t } = useLocale();
  const shownMappings = cardMappings ?? realScene.scenePlan.mappings;
  // const mapping = primaryMapping(realScene);
  // REAL 2026-10-04 DEFECT: a scene holding a phone screen AND texts read
  // "No asset assigned yet" with its screenshot assigned, because the file
  // and the text were both read off ONE "primary" layer - whichever came
  // first. A scene's picture and its wording live on different layers, so
  // each fact is taken from the first layer that actually has it.
  // const mapping = primaryMapping(shownMappings);
  // const asset = mapping?.selectedAssetId ? ((assets ?? []).find((a) => a.id === mapping.selectedAssetId) ?? null) : null;
  const mapping = shownMappings.find((m) => m.text) ?? primaryMapping(shownMappings);
  const assetMapping = shownMappings.find((m) => m.selectedAssetId) ?? null;
  const asset = assetMapping ? ((assets ?? []).find((a) => a.id === assetMapping.selectedAssetId) ?? null) : null;
  // 2026-09-28, real client session: a 77-composition template surfaced 30
  // structural layers (a border overlay, a "Sharpen" adjustment layer, a
  // black fade solid) as editable placeholders. Claude examined each, said in
  // its reasoning that none is a content slot, and returned a suggestion
  // carrying NO text, NO asset and NO classification - it proposes nothing.
  //
  // This card rendered each of those as a review item anyway: thirty
  // identical pairs of blank "Keep original / Use suggestion" buttons in one
  // scene, with the reasoning that explains them stored but never shown. A
  // decision with nothing to decide is not a decision, and thirty of them is
  // not a review queue.
  //
  // A suggestion now reaches the queue only when it actually proposes
  // something. The rest are reported as what they are - findings, with the
  // reasoning visible - and still individually actionable, so nothing is
  // hidden or applied on the operator's behalf.
  const proposals = pendingSuggestions.filter(
    (s) => s.suggestedText !== null || s.suggestedAssetId !== null || s.suggestedClassification !== null
  );
  const findings = pendingSuggestions.filter(
    (s) => s.suggestedText === null && s.suggestedAssetId === null && s.suggestedClassification === null
  );
  // Text layers nobody has decided about: no text typed, and no recorded
  // "keep the template's text". Each keeps its scene from being approved.
  const undecidedTexts = shownMappings.filter(
    (m) => m.placeholderClassification?.value === "text" && (m.text === null || m.text.trim() === "") && (m.keepTemplateText ?? null) === null
  );
  const undecidedTextIds = new Set(undecidedTexts.map((m) => m.id));
  // Those with nothing pending about them have no other control on this card
  // at all - they get a plain question of their own (below).
  const pendingMappingIds = new Set(pendingSuggestions.map((suggestion) => suggestion.mappingId));
  const leftoverTexts = onKeepTemplateText ? undecidedTexts.filter((m) => !pendingMappingIds.has(m.id)) : [];
  // REAL 2026-10-06 DEAD END: a picture place nobody put a picture in (a
  // background the client did not want) kept its scene "Needs your choice"
  // with no question and no control anywhere that could settle it - the same
  // dead end texts had on 2026-10-04. "Leave it as the template has it" is a
  // complete answer for a picture place too, recorded the same way.
  const leftoverPictures = onKeepTemplateText
    ? shownMappings.filter(
        (m) =>
          PICTURE_KINDS.has(m.placeholderClassification?.value ?? "") &&
          m.selectedAssetId === null &&
          (m.keepTemplateText ?? null) === null &&
          !pendingMappingIds.has(m.id)
      )
    : [];
  const ownedIds = new Set(realScene.scenePlan.mappings.map((m) => m.id));
  const shownIds = new Set(shownMappings.map((m) => m.id));
  const showsEverythingItOwns = [...ownedIds].every((id) => shownIds.has(id));
  const hasGenuineReview = proposals.length > 0;
  // const hasNoMappingsToReview = realScene.scenePlan.mappings.length === 0;
  const hasNoMappingsToReview = shownMappings.length === 0;
  const status = deriveCardStatus(
    hasGenuineReview,
    previewEntry.state,
    previewEntry.isStale,
    realScene.scenePlan.approvalState,
    hasNoMappingsToReview,
    undecidedTexts.length > 0 || leftoverPictures.length > 0,
    showsEverythingItOwns
  );
  const canRegenerate = previewEntry.state === "idle" || previewEntry.state === "ready" || previewEntry.state === "unavailable";

  return (
    <Card className="scene-card">
      {/*
        2026-10-04 audit: the card's big title was the template author's name
        ("Transition_scene_03", "!MAIN") with "Scene 3" as a small label above
        it. A client reads the big one. The plain name is the title now; the
        template's name stays on hover for whoever matches it to After Effects.
      */}
      <div className="scene-card__header">
        <h3 title={realScene.sceneName}>{eyebrow ?? realScene.sceneName}</h3>
        <span className={`status-badge status-badge--${STATUS_TONE[status]}`}>{t.simpleScenes.status[status]}</span>
      </div>

      <PreviewBeforeAfter projectId={projectId} realScene={realScene} previewEntry={previewEntry} />

      {/*
        2026-10-04: "Preview generating…" was a badge and nothing else - no
        sign that anything was moving, or for how long. A running preview
        now says so with a clock; one waiting behind another says it is
        waiting its turn (they are made one at a time), which is why its own
        clock has not started.
      */}
      {previewEntry.state === "generating" ? (
        <BusyNotice compact title={t.simpleScenes.previewBusy.generating} description={t.simpleScenes.previewBusy.generatingHint} startedAt={previewEntry.startedAt ?? null} />
      ) : previewEntry.state === "queued" ? (
        <BusyNotice compact title={t.simpleScenes.previewBusy.queued} />
      ) : null}

      <dl className="scene-card__facts">
        <div>
          <dt>{t.simpleScenes.screenLabel}</dt>
          <dd className="scene-card__picture">
            {asset && asset.mediaKind !== "VIDEO" ? <img src={assetFileUrl(projectId, asset.id)} alt="" className="scene-card__picture-thumb" /> : null}
            <span>{asset ? (asset.label ?? asset.originalFilename) : status === "noChangeNeeded" ? t.simpleScenes.originalContentKept : t.simpleScenes.noAssetAssigned}</span>
          </dd>
        </div>
        <div>
          <dt>{t.simpleScenes.textLabel}</dt>
          <dd>{mapping?.text ?? (status === "noChangeNeeded" ? t.simpleScenes.originalTextPreserved : t.simpleScenes.noTextLabel)}</dd>
        </div>
        {/* A length nobody set is the template's own and needs no line of its own. */}
        {realScene.scenePlan.finalDuration !== null || status === "noChangeNeeded" ? (
          <div>
            <dt>{t.simpleScenes.durationLabel}</dt>
            <dd>
              {realScene.scenePlan.finalDuration !== null
                ? t.simpleScenes.durationSeconds(realScene.scenePlan.finalDuration)
                : t.simpleScenes.originalTimingPreserved}
            </dd>
          </div>
        ) : null}
      </dl>

      {previewEntry.errorMessage ? (
        <>
          <p className="scene-card__error">
            {t.simpleScenes.previewErrorPrefix} {previewEntry.errorMessage}
          </p>
          {/*
            REAL 2026-10-04: the message said "Please try again" and the only
            way to do so was folded away under Advanced details.
          */}
          <Button size="sm" variant="secondary" disabled={!canRegenerate} onClick={onRegeneratePreview}>
            {t.simpleScenes.tryPreviewAgainAction}
          </Button>
        </>
      ) : null}

      <div className="scene-card__actions">
        <Button size="sm" variant="secondary" onClick={() => onEdit()}>
          {t.simpleScenes.editAction}
        </Button>
      </div>

      {hasGenuineReview ? (
        <div className="scene-card__review-queue">
          <h4>{t.simpleScenes.reviewQueueTitle}</h4>
          {/* One press for the whole card - several suggestions each with their own pair of buttons is slow to get through. */}
          {proposals.length > 1 && onAcceptSuggestions ? (
            <Button size="sm" variant={quietActions ? "secondary" : "primary"} disabled={suggestionsBusy} onClick={() => onAcceptSuggestions(proposals)}>
              {t.simpleScenes.useAllSuggestionsAction(proposals.length)}
            </Button>
          ) : null}
          {proposals.map((suggestion) => {
            const suggestedAsset = suggestion.suggestedAssetId ? ((assets ?? []).find((a) => a.id === suggestion.suggestedAssetId) ?? null) : null;
            // The layer THIS suggestion is for. Was always the card's first
            // mapping, so every suggestion showed the same "currently" text
            // and none said which layer it meant.
            const target = shownMappings.find((m) => m.id === suggestion.mappingId) ?? null;
            return (
              <div key={suggestion.id} className="scene-card__review-item">
                {/*
                  2026-10-04: a picture's layer is named by whoever built the
                  template ("White Solid 2") and says nothing to a client. A
                  picture is called a picture; a text layer keeps its name,
                  which is how several texts in one scene are told apart.
                */}
                {target?.placeholderName ? (
                  <p className="scene-card__review-layer">
                    {PICTURE_KINDS.has(target.placeholderClassification?.value ?? "") ? t.simpleScenes.screenLabel : target.placeholderName}
                  </p>
                ) : null}
                {suggestion.suggestedText ? (
                  <>
                    {/* <p className="scene-card__review-current">{t.simpleScenes.currentTextLabel(mapping?.text ?? "")}</p> */}
                    {target?.text ? <p className="scene-card__review-current">{t.simpleScenes.currentTextLabel(target.text)}</p> : null}
                    <p className="scene-card__review-suggested">{t.simpleScenes.suggestedTextLabel(suggestion.suggestedText)}</p>
                  </>
                ) : suggestedAsset ? (
                  suggestedAsset.mediaKind === "VIDEO" ? (
                    <video src={assetFileUrl(projectId, suggestedAsset.id)} className="scene-card__review-thumb" muted />
                  ) : (
                    <img src={assetFileUrl(projectId, suggestedAsset.id)} alt="" className="scene-card__review-thumb" />
                  )
                ) : suggestion.suggestedClassification ? (
                  // A proposal about what KIND of layer this is carries no
                  // text and no file - it rendered as two buttons under nothing.
                  <p className="scene-card__review-suggested">{t.simpleScenes.suggestedKindLabel(suggestion.suggestedClassification)}</p>
                ) : null}
                <div className="scene-card__review-actions">
                  <Button size="sm" variant="ghost" disabled={suggestionsBusy} onClick={() => onRejectSuggestion(suggestion)}>
                    {t.simpleScenes.keepOriginalAction}
                  </Button>
                  <Button size="sm" variant={quietActions ? "secondary" : "primary"} disabled={suggestionsBusy} onClick={() => onAcceptSuggestion(suggestion)}>
                    {t.simpleScenes.useSuggestionAction}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {findings.length > 0 ? (
        <details className="scene-card__findings">
          <summary>{t.simpleScenes.findingsTitle(findings.length)}</summary>
          <p className="scene-card__findings-description">{t.simpleScenes.findingsDescription}</p>
          {findings.map((finding) => (
            <div key={finding.id} className="scene-card__finding">
              {(() => {
                // The layer's own name lives on the mapping this suggestion
                // is about, never on the suggestion itself. Omitted rather
                // than invented when the mapping cannot be found.
                const named = shownMappings.find((m) => m.id === finding.mappingId);
                return named?.placeholderName ? <p className="scene-card__finding-layer">{t.simpleScenes.findingsLayerLabel(named.placeholderName)}</p> : null;
              })()}
              <p className="scene-card__finding-reason">{finding.reasoning ?? t.simpleScenes.findingsNoReason}</p>
            </div>
          ))}
          {/*
            ONE action for the whole set, not one per finding - a button per
            item is exactly the wall this block exists to remove.
            It is still required: an unresolved suggestion keeps the scene out
            of `reviewsReady`, so leaving thirty of them pending would disable
            Approve Scenes forever with no way to clear them.
          */}
          <Button
            size="sm"
            variant="ghost"
            disabled={suggestionsBusy}
            onClick={() => {
              // REAL 2026-10-04 DEAD END: agreeing here recorded nothing on
              // the plan, so a text layer left "as the template has it" kept
              // its scene at "needs your choice" for ever. Agreeing now also
              // records that decision for each text layer it is about.
              if (onKeepTemplateText) {
                onKeepTemplateText(
                  findings.flatMap((finding) => (finding.mappingId !== null && undecidedTextIds.has(finding.mappingId) ? [finding.mappingId] : [])),
                  findings
                );
              } else {
                findings.forEach((finding) => onAcceptSuggestion(finding));
              }
            }}
          >
            {t.simpleScenes.findingsAcceptAllAction(findings.length)}
          </Button>
        </details>
      ) : null}

      {/*
        REAL 2026-10-06 (client project 3241977f): this block named the open
        text by its layer ("Text A") while the panel called the same box
        "Text 3", and its only button was "Keep the template's text" without
        saying what that text is - here the template's English headline, in a
        Hebrew video. Each open text is now shown by the words the video
        would carry, with its own button that opens the panel on that very
        box; keeping the template's words is the quieter second choice and
        says which words.
      */}
      {leftoverTexts.length > 0 ? (
        <div className="scene-card__leftover">
          <p className="scene-card__review-title">{t.simpleScenes.leftoverTextTitle(leftoverTexts.length)}</p>
          <p className="scene-card__finding-reason">{t.simpleScenes.leftoverTextHint}</p>
          <ul className="scene-card__leftover-list">
            {leftoverTexts.map((m) => {
              const words = templateTextOf?.(m) ?? null;
              return (
                <li key={m.id} className="scene-card__leftover-item">
                  <span className="scene-card__leftover-words" dir="auto">
                    {words === null ? m.placeholderName : t.simpleScenes.leftoverTextTemplateSays(words)}
                  </span>
                  <span className="scene-card__leftover-actions">
                    <Button size="sm" variant={quietActions ? "secondary" : "primary"} onClick={() => onEdit(m.id)}>
                      {t.simpleScenes.leftoverTextWriteAction}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={suggestionsBusy} onClick={() => onKeepTemplateText?.([m.id], [])}>
                      {words === null ? t.simpleScenes.leftoverTextKeepAction(1) : t.simpleScenes.leftoverTextKeepWordsAction(words)}
                    </Button>
                    {onNoText ? (
                      <Button size="sm" variant="ghost" disabled={suggestionsBusy} onClick={() => onNoText(m.id)}>
                        {t.simpleScenes.leftoverTextNoTextAction}
                      </Button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {leftoverPictures.length > 0 ? (
        <div className="scene-card__leftover">
          <p className="scene-card__review-title">{t.simpleScenes.leftoverPictureTitle(leftoverPictures.length)}</p>
          <p className="scene-card__finding-reason">{t.simpleScenes.leftoverPictureHint}</p>
          <Button size="sm" variant="secondary" disabled={suggestionsBusy} onClick={() => onKeepTemplateText?.(leftoverPictures.map((m) => m.id), [])}>
            {t.simpleScenes.leftoverPictureKeepAction(leftoverPictures.length)}
          </Button>
        </div>
      ) : null}

      <details className="advanced-details">
        <summary>{t.simpleScenes.advancedDetailsToggle}</summary>
        <dl className="scene-card__advanced-facts">
          <div>
            <dt>Composition ID</dt>
            <dd>{realScene.manifestCompositionId}</dd>
          </div>
          {realScene.nested.length > 0 ? (
            <div>
              <dt>Nested compositions</dt>
              <dd>{realScene.nested.map((n) => n.compositionName).join(", ")}</dd>
            </div>
          ) : null}
        </dl>
        <Button size="sm" variant="secondary" disabled={!canRegenerate} onClick={onRegeneratePreview}>
          {t.simpleScenes.regeneratePreviewAction}
        </Button>
      </details>
    </Card>
  );
}
