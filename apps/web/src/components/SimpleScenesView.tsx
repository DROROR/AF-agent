"use client";

import Link from "next/link";

import { useRouter } from "next/navigation";
import { useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTabsEndSlot } from "./ProjectWorkspaceShell";
import type { MappingSuggestion } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { WholeVideoColours } from "./WholeVideoColours";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { useMappingSuggestions } from "../lib/use-mapping-suggestions";
import { resolveSceneMappingHomes } from "../lib/scene-mapping-homes";
import { useProjectAssets } from "../lib/use-project-assets";
import { groupIntoRealScenes } from "../lib/real-scene-grouping";
import { isScenePreviewSettled, useScenePreviewQueue } from "../lib/use-scene-preview-queue";
import { SceneCard } from "./SceneCard";
import { SceneEditDrawer } from "./SceneEditDrawer";
import { findPendingPictureSlots, SlotBulkReview } from "./SlotBulkReview";
import type { GuideStep } from "./ScenesGuide";
import { BrandNeeds } from "./BrandNeeds";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { BusyNotice } from "./ui/BusyNotice";
import { ClaudeActionButton } from "./ui/ClaudeActionButton";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { Skeleton } from "./ui/Skeleton";
import { useLocale } from "./LocaleProvider";

/*
 * 2026-10-06: a strip of small thumbnails ("Storyboard") used to head this
 * page. Each scene's card now shows the same frame at full width directly
 * below, so the strip was the same pictures twice on a page the client called
 * complicated. It is gone; the cards are the storyboard.
 */

/**
 * "Review Scenes" (client-facing UX redesign, sections B-G + "M. VISUAL
 * PREVIEWS ARE MANDATORY" + the "LIVE UX ACCEPTANCE FAILED" section 6
 * follow-up) - one visual card per REAL user-facing scene (never one row
 * per raw AE composition/placeholder), each with a real visual preview
 * generated AUTOMATICALLY (see use-scene-preview-queue.ts) and only
 * genuine content decisions surfaced for review. Structural/no-op
 * suggestions never reach here - useMappingSuggestions only ever returns
 * PENDING items, and RESOLVED (structural keep-original) suggestions are
 * a separate bucket this view never renders (see MappingAssistantPanel's
 * own `resolved` split for the Advanced-mode equivalent).
 */
/** Draws the controls at the end of the tab row when the shell offers that place; on their own (tests, no shell) they stand in a plain row. */
function portalInto(slot: HTMLElement | null, children: ReactNode): ReactNode {
  return slot ? createPortal(<span className="workspace-tabs__controls">{children}</span>, slot) : <div className="simple-scenes__controls">{children}</div>;
}

export function SimpleScenesView(): ReactElement {
  const { t } = useLocale();
  const router = useRouter();
  const tabsEnd = useTabsEndSlot();
  const { project, plan, approveScenes, isStale, createPlan, refetch, applyEdit } = useProjectWorkspaceContext();
  // 2026-09-28: Simple mode consumed suggestions but could never ASK for
  // them - `generate` lived only in MappingAssistantPanel, which Advanced
  // mode renders and Simple mode does not. So the view that exists to be the
  // easy path showed "Needs your choice" on every scene with nothing
  // suggested, and the one feature that would have answered it was reachable
  // only by switching to Advanced. Reported by a real operator mid-session.
  const { suggestions, aiAvailable, isGenerating, error: suggestionsError, generate, accept, reject, acceptBatch } = useMappingSuggestions(
    project?.project.projectId ?? ""
  );
  const { assets } = useProjectAssets(project?.project.projectId ?? "");
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  // Set when Edit is pressed on a card that SHOWS layers another scene
  // owns: the drawer then opens the owner, narrowed to that card's layers.
  const [editingMappingIds, setEditingMappingIds] = useState<string[] | null>(null);
  // The one layer the panel should open on, when a card's own "write my text" button opened it.
  const [focusMappingId, setFocusMappingId] = useState<string | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // True when the refusal above is the slot gate and this page can name the pictures it means (see cardsNeedingConfirmation).
  const [actionErrorIsPictures, setActionErrorIsPictures] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);

  const projectId = project?.project.projectId ?? "";
  const realScenes = project && plan ? groupIntoRealScenes(project.manifest, plan.plan.scenePlans) : [];
  const previewQueue = useScenePreviewQueue(projectId, realScenes, dashboardStatus?.workers ?? null, project?.project.sourceWorkerId ?? null);

  if (!project) {
    return <Skeleton height="1.5rem" />;
  }

  if (!plan) {
    return (
      <Card>
        <EmptyState
          title={t.projectWorkspace.noPlanTitle}
          description={t.projectWorkspace.noPlanDescription}
          action={
            <Button
              variant="primary"
              disabled={isCreatingPlan}
              onClick={() => {
                setIsCreatingPlan(true);
                void createPlan().finally(() => setIsCreatingPlan(false));
              }}
            >
              {isCreatingPlan ? t.projectWorkspace.creatingPlan : t.projectWorkspace.createPlanAction}
            </Button>
          }
        />
      </Card>
    );
  }

  const pending = (suggestions ?? []).filter((s) => s.status === "PENDING");
  const allProposals = (suggestions ?? []).filter(
    (s) => s.status === "PENDING" && (s.suggestedText !== null || s.suggestedAssetId !== null || s.suggestedClassification !== null)
  );
  const pendingByScene = new Map<string, MappingSuggestion[]>();
  // Which card each layer is shown on - see resolveSceneMappingHomes.
  const homes = resolveSceneMappingHomes(project.manifest, realScenes);
  // The template's own wording per text layer, only where the manifest holds
  // it in full - an excerpt is not what the video would show.
  const templateTextByPlaceholderId = new Map<string, string>();
  for (const manifestScene of project.manifest.scenes) {
    for (const placeholder of manifestScene.placeholders) {
      if (placeholder.originalTextTruncated !== true && typeof placeholder.originalText === "string" && placeholder.originalText.trim() !== "") {
        templateTextByPlaceholderId.set(placeholder.placeholderId, placeholder.originalText);
      }
    }
  }
  const templateTextOf = (mapping: { manifestPlaceholderId: string | null }): string | null =>
    mapping.manifestPlaceholderId === null ? null : (templateTextByPlaceholderId.get(mapping.manifestPlaceholderId) ?? null);
  for (const suggestion of pending) {
    // Was bucketed by suggestion.scenePlanId alone, which put every
    // suggestion of a single-master template on the master's one card.
    // const bucket = pendingByScene.get(suggestion.scenePlanId) ?? [];
    const cardId = (suggestion.mappingId !== null ? homes.cardIdByMappingId.get(suggestion.mappingId) : undefined) ?? suggestion.scenePlanId;
    const bucket = pendingByScene.get(cardId) ?? [];
    bucket.push(suggestion);
    pendingByScene.set(cardId, bucket);
  }

  const reviewsReady = realScenes.every(
    (scene) =>
      (pendingByScene.get(scene.scenePlan.id)?.length ?? 0) === 0 &&
      (scene.scenePlan.approvalState === "READY_FOR_APPROVAL" || scene.scenePlan.approvalState === "APPROVED")
  );
  // Preview freshness (final MVP polish item 2): a stale scene preview -
  // captured before the mapped asset/text/timestamp/duration change that
  // is now current, per useScenePreviewQueue's own isStale check - can
  // never be treated as the current, approved-against evidence. This
  // never requires a manual refresh: the same queue that computed
  // isStale already auto-queued a fresh capture for it (see
  // use-scene-preview-queue.ts's own needsPreview logic), so this
  // condition self-resolves as soon as that regeneration completes -
  // approval is simply held until the client is genuinely looking at the
  // real, current result, not a guess about whether it still matches.
  // A preview whose generation definitively failed is settled too - see
  // isScenePreviewSettled for the real lock this prevents.
  const previewsReady = realScenes.every((scene) => isScenePreviewSettled(previewQueue.getEntry(scene.scenePlan.id)));
  const allReady = reviewsReady && previewsReady;
  // For the "updating previews" notice: how many are settled, and since when
  // the oldest one still running has been going.
  const previewEntries = realScenes.map((scene) => previewQueue.getEntry(scene.scenePlan.id));
  const previewsSettledCount = previewEntries.filter(isScenePreviewSettled).length;
  const previewsBusySince = previewEntries.reduce<number | null>(
    (earliest, entry) => (entry.startedAt != null && (earliest === null || entry.startedAt < earliest) ? entry.startedAt : earliest),
    null
  );
  // Approved means executable: the plan AND every included scene - exactly
  // what the Preview tab needs (see useProjectWorkspace's approveScenes).
  const usedScenes = plan.plan.scenePlans.filter((scene) => scene.use);
  const scenesApproved = plan.plan.status === "APPROVED" && usedScenes.length > 0 && usedScenes.every((scene) => scene.approvalState === "APPROVED");

  // WHAT TO DO NOW, IN ORDER (2026-10-04). A non-technical client faced this
  // tab with nothing saying where to start or what came next. Each step is
  // derived from the same state the buttons below already act on, so the
  // guide can never say something the screen then contradicts.
  const pendingPictures = findPendingPictureSlots(project, plan.plan.scenePlans, assets);
  const picturesWaiting = pendingPictures.length;
  const nothingChosenYet = plan.plan.scenePlans.every((scene) => scene.mappings.every((m) => m.text === null && m.selectedAssetId === null && m.colorHex === null));
  const scenesWaiting = realScenes.filter(
    (scene) =>
      (pendingByScene.get(scene.scenePlan.id)?.length ?? 0) > 0 ||
      !(scene.scenePlan.approvalState === "READY_FOR_APPROVAL" || scene.scenePlan.approvalState === "APPROVED")
  ).length;
  // Nothing left to take from the plan - or the scenes are already settled
  // without it, in which case there is nothing to send the client back for.
  const planStepDone = allProposals.length === 0 && (!nothingChosenYet || reviewsReady);
  const brandNeeds = plan.plan.status === "DRAFT" ? (plan.brandNeeds ?? []) : [];
  const guideSteps: GuideStep[] = [
    {
      title: t.simpleScenes.guide.planTitle,
      detail: planStepDone
        ? t.simpleScenes.guide.planDone
        : allProposals.length > 0
          ? t.simpleScenes.guide.planNow(allProposals.length)
          : t.simpleScenes.guide.planAsk,
      done: planStepDone
    },
    {
      title: t.simpleScenes.guide.picturesTitle,
      detail: picturesWaiting > 0 ? t.simpleScenes.guide.picturesNow(picturesWaiting) : t.simpleScenes.guide.picturesDone,
      done: picturesWaiting === 0
    },
    {
      title: t.simpleScenes.guide.leftoverTitle,
      detail: scenesWaiting > 0 ? t.simpleScenes.guide.leftoverNow(scenesWaiting) : t.simpleScenes.guide.leftoverDone,
      done: scenesWaiting === 0
    },
    // The two things every DYO video must carry, said as a step of their own
    // BEFORE approval - they used to appear only as approval's refusal.
    ...(brandNeeds.length > 0 || plan.brandNeeds !== undefined
      ? [{ title: t.simpleScenes.guide.brandTitle, detail: brandNeeds.length > 0 ? t.simpleScenes.guide.brandNow(brandNeeds.length) : t.simpleScenes.guide.brandDone, done: brandNeeds.length === 0 }]
      : []),
    {
      title: t.simpleScenes.guide.approveTitle,
      detail: scenesApproved ? t.simpleScenes.scenesApprovedHint : !previewsReady && reviewsReady ? t.simpleScenes.previewsUpdatingHint : t.simpleScenes.guide.approveNow,
      done: scenesApproved
    }
  ];

  // ONE PRIMARY BUTTON (2026-10-04). "Use everything from my plan", "Yes -
  // all are in the right place", every card's "Use this" and "Approve
  // Scenes" could all be drawn at full weight at once, and the client had to
  // work out which came first. The guide above already knows: the step it
  // marks "now" is the one whose button is primary; the rest are still there
  // and still work, drawn quieter. -1 means every step is done.
  const currentGuideStep = guideSteps.findIndex((step) => !step.done);
  const GUIDE_PLAN = 0;
  const GUIDE_PICTURES = 1;
  const GUIDE_LEFTOVER = 2;

  // What each card is called for a person (the template's own name stays
  // beneath it). A card whose scene also owns layers shown on OTHER cards is
  // the video as a whole; the rest are numbered in the order they are shown.
  const cardLabels = new Map<string, string>();
  const quietCards = new Set<string>();
  let sceneNumber = 0;
  for (const realScene of realScenes) {
    const shown = homes.mappingsByCardId.get(realScene.scenePlan.id) ?? [];
    const ownsLayersShownElsewhere = realScene.scenePlan.mappings.some((mapping) => {
      const cardId = homes.cardIdByMappingId.get(mapping.id);
      return cardId !== undefined && cardId !== realScene.scenePlan.id;
    });
    if (shown.length === 0 && (pendingByScene.get(realScene.scenePlan.id)?.length ?? 0) === 0) {
      quietCards.add(realScene.scenePlan.id);
    } else if (ownsLayersShownElsewhere) {
      cardLabels.set(realScene.scenePlan.id, t.simpleScenes.wholeVideoLabel);
    } else {
      sceneNumber += 1;
      cardLabels.set(realScene.scenePlan.id, t.simpleScenes.sceneNumberLabel(sceneNumber));
    }
  }

  // REAL 2026-09-25 INCIDENT: "Approve Scenes" is disabled for FIVE
  // genuinely different reasons and looked identical in all of them. Three
  // of those five were already explained by the status line rendered
  // directly above the button (approved / not reviewed / previews
  // updating) - those keep that existing wording, which real regression
  // tests pin to specific incidents. The two that were NEVER explained
  // anywhere - a revision saved elsewhere, and an approval already in
  // flight - now state themselves on the control itself. Evaluated in the
  // same order as the `disabled` expression below, so the stated reason is
  // always the one really holding the button.
  // REAL 2026-10-09 (QA project, a non-technical reader): "Approve Scenes"
  // was enabled while two pictures still waited for their confirmation, and
  // the server's refusal came back as one red paragraph of codes and layer
  // names - "SLOT_CLASSIFICATION_UNCERTAIN", "UNSAFE_FIT" - that said
  // nothing about where to go or what to press. The gate is right; the
  // page knows exactly which pictures it means (pendingPictures, the same
  // list the box above draws), so it now says so in the button's own
  // reason, marks those scenes' cards, and never lets the raw refusal be
  // the only explanation.
  const cardsNeedingConfirmation = new Set(pendingPictures.map((slot) => homes.cardIdByMappingId.get(slot.mappingId) ?? slot.scenePlanId));
  const picturesHold = !scenesApproved && picturesWaiting > 0;
  const approveDisabledReason = scenesApproved
    ? undefined
    : picturesHold
      ? t.simpleScenes.approveNeedsPictures(picturesWaiting)
      : !allReady
        ? undefined
        : isStale
          ? t.projectWorkspace.disabledReason.staleRevision
          : isApproving
            ? t.projectWorkspace.disabledReason.working
            : undefined;
  const confirmationCardLabels = [...cardsNeedingConfirmation].map((cardId) => cardLabels.get(cardId) ?? null).filter((label): label is string => label !== null);

  async function handleAccept(suggestion: MappingSuggestion): Promise<void> {
    setBusySuggestionId(suggestion.id);
    setActionError(null);
    const result = await accept(suggestion.id, plan!.plan.revision);
    setBusySuggestionId(null);
    if (!result.ok) {
      setActionError(result.message ?? null);
      return;
    }
    // Accepting writes to the plan and moves its revision on. REAL 2026-10-02
    // DEFECT: this screen kept the old one, so the very next edit was refused
    // with "Expected revision 3, but the current revision is 4", and the card
    // went on showing "No text set" for a text that had just been accepted.
    await refetch();
  }

  /** Several suggestions in one request - one plan revision, one result. */
  async function handleAcceptMany(many: MappingSuggestion[]): Promise<void> {
    if (many.length === 0) {
      return;
    }
    setBusySuggestionId(many[0]!.id);
    setActionError(null);
    const result = await acceptBatch(
      many.map((suggestion) => suggestion.id),
      plan!.plan.revision
    );
    setBusySuggestionId(null);
    if (!result.ok) {
      setActionError(result.message ?? null);
      return;
    }
    await refetch();
  }

  /**
   * "Leave it as the template has it" as a real, recorded decision (see
   * compute-scene-unresolved-reasons.ts, 2026-10-04): settles any no-change
   * findings, then records KEEP_TEMPLATE_TEXT for each text layer named, in
   * the reviewer's name. One plan edit for all of them.
   */
  async function handleKeepTemplateText(mappingIds: string[], findings: MappingSuggestion[], decision: "KEEP_TEMPLATE_TEXT" | "NO_TEXT" = "KEEP_TEMPLATE_TEXT"): Promise<void> {
    setBusySuggestionId(findings[0]?.id ?? "keep-template-text");
    setActionError(null);
    for (const finding of findings) {
      const result = await accept(finding.id, plan!.plan.revision);
      if (!result.ok) {
        setBusySuggestionId(null);
        setActionError(result.message ?? null);
        return;
      }
    }
    const operations = mappingIds.flatMap((mappingId) => {
      const owner = plan!.plan.scenePlans.find((scene) => scene.mappings.some((m) => m.id === mappingId));
      return owner ? [{ type: "SET_TEMPLATE_TEXT_DECISION" as const, scenePlanId: owner.id, mappingId, decision }] : [];
    });
    if (operations.length > 0) {
      const result = await applyEdit(operations);
      if (!result.ok) {
        setActionError(result.message ?? null);
      }
    } else {
      await refetch();
    }
    setBusySuggestionId(null);
  }

  async function handleReject(suggestion: MappingSuggestion): Promise<void> {
    setBusySuggestionId(suggestion.id);
    setActionError(null);
    const result = await reject(suggestion.id);
    setBusySuggestionId(null);
    if (!result.ok) {
      setActionError(result.message ?? null);
    }
  }

  async function handleApprove(): Promise<void> {
    if (isApproving) {
      return;
    }
    setIsApproving(true);
    setActionError(null);
    const result = await approveScenes();
    setIsApproving(false);
    if (!result.ok) {
      setActionError(result.message ?? null);
      setActionErrorIsPictures(picturesWaiting > 0 && /unresolved slot findings/i.test(result.message ?? ""));
      return;
    }
    // 2026-10-04: after a successful approval the page stayed exactly where
    // it was, with the button now greyed out, and the client concluded the
    // click had failed. The next step is on the Preview tab, so go there -
    // the same route the tab itself links to. This view is only ever shown
    // in Simple mode (ProjectScenesTab); Advanced keeps its own table and
    // stays put. Only on success: a refusal stays here, where its reason is.
    router.push(`/projects/${projectId}/preview`);
  }

  return (
    <>
      {isStale ? <ErrorState title={t.projectWorkspace.staleRevisionTitle} description={t.projectWorkspace.staleRevisionDescription} /> : null}
      {actionError && actionErrorIsPictures ? (
        <div className="simple-scenes__refusal">
          <ErrorState title={t.simpleScenes.approveRefusedPicturesTitle} description={t.simpleScenes.approveRefusedPictures(picturesWaiting, confirmationCardLabels)} />
          <details className="advanced-details">
            <summary>{t.common.technicalDetails}</summary>
            <p className="simple-scenes__refusal-raw">{actionError}</p>
          </details>
        </div>
      ) : actionError ? (
        <ErrorState title={t.projectWorkspace.saveFailedTitle} description={actionError} />
      ) : null}


      {suggestionsError ? (
        <ErrorState title={t.mappingAssistant.title} description={suggestionsError} />
      ) : null}


      {/*
        2026-10-08, the operator: "one button does not need a whole card, and
        why fold it away" - the two controls sit at the end of the tab row
        (through the shell's slot) and nothing else is left of the bar.
        The notices about work under way stay here, in the page.
      */}
      {portalInto(
        tabsEnd,
        <>
          {aiAvailable ? (
            <ClaudeActionButton
              label={t.mappingAssistant.generateAction}
              busyLabel={t.mappingAssistant.generating}
              busy={isGenerating}
              disabled={isStale}
              quiet={currentGuideStep !== GUIDE_PLAN}
              onClick={() => void generate()}
            />
          ) : null}
          {allProposals.length > 0 ? (
            <Button variant={currentGuideStep === GUIDE_PLAN ? "primary" : "secondary"} disabled={busySuggestionId !== null || isStale} onClick={() => void handleAcceptMany(allProposals)}>
              {t.simpleScenes.useWholePlanAction(allProposals.length)}
            </Button>
          ) : null}
          {scenesApproved ? (
            <Link href={`/projects/${projectId}/preview`} className="btn btn--primary">
              {t.simpleScenes.goToPreviewAction}
            </Link>
          ) : (
            <Button
              variant={currentGuideStep === guideSteps.length - 1 || currentGuideStep === -1 ? "primary" : "secondary"}
              disabled={!allReady || isApproving || isStale || picturesHold}
              disabledReason={approveDisabledReason}
              onClick={() => void handleApprove()}
            >
              {isApproving ? t.simpleScenes.approvingScenes : t.simpleScenes.approveScenesAction}
            </Button>
          )}
        </>
      )}
      {aiAvailable ? null : <p className="simple-scenes__ai-hint">{t.mappingAssistant.connectProviderHint}</p>}
      {reviewsReady && !previewsReady && !scenesApproved ? (
        <BusyNotice
          compact
          title={t.simpleScenes.previewBusy.updatingCount(previewsSettledCount, realScenes.length)}
          description={t.simpleScenes.previewBusy.updatingHint}
          startedAt={previewsBusySince}
        />
      ) : null}
      {isApproving ? <BusyNotice compact title={t.simpleScenes.approvingScenes} description={t.simpleScenes.previewBusy.approvingHint} /> : null}

      {/*
        2026-10-06, after the client still called this page complicated: it
        opened with a strip of thumbnails and a closed line about colours, and
        only then said what to do. The instructions come first now, and the
        colours card is a real, open card (it was a collapsed line the client
        was told about and could not see).
      */}
      {/* Right under the guide that names it as the step to do now. */}
      {plan && project ? <BrandNeeds projectId={projectId} needs={brandNeeds} scenePlans={plan.plan.scenePlans} assets={assets} disabled={isStale} applyEdit={applyEdit} /> : null}
      {plan && project ? <WholeVideoColours scenePlans={plan.plan.scenePlans} manifest={project.manifest} disabled={isStale} applyEdit={applyEdit} /> : null}

      <SlotBulkReview isCurrentStep={currentGuideStep === GUIDE_PICTURES} sceneLabelFor={(slot) => cardLabels.get(homes.cardIdByMappingId.get(slot.mappingId) ?? slot.scenePlanId) ?? null} />

      {realScenes.length === 0 ? (
        <Card>
          <EmptyState title={t.simpleScenes.emptyTitle} description={t.simpleScenes.emptyDescription} />
        </Card>
      ) : (
        <>
        <p className="simple-scenes__frames-note">{t.simpleScenes.framesNote}</p>
        <div className="simple-scenes__grid">
          {realScenes.filter((realScene) => !quietCards.has(realScene.scenePlan.id)).map((realScene) => (
            <SceneCard
              key={realScene.manifestCompositionId}
              {...(cardLabels.has(realScene.scenePlan.id) ? { eyebrow: cardLabels.get(realScene.scenePlan.id)! } : {})}
              projectId={projectId}
              realScene={realScene}
              assets={assets}
              previewEntry={previewQueue.getEntry(realScene.scenePlan.id)}
              pendingSuggestions={pendingByScene.get(realScene.scenePlan.id) ?? []}
              suggestionsBusy={busySuggestionId !== null}
              quietActions={currentGuideStep !== GUIDE_LEFTOVER}
              cardMappings={(homes.mappingsByCardId.get(realScene.scenePlan.id) ?? []).map((hosted) => hosted.mapping)}
              needsConfirmation={cardsNeedingConfirmation.has(realScene.scenePlan.id)}
              // onEdit={() => setEditingSceneId(realScene.scenePlan.id)}
              onEdit={(focusMappingId) => {
                setFocusMappingId(focusMappingId ?? null);
                const hosted = homes.mappingsByCardId.get(realScene.scenePlan.id) ?? [];
                const owner = hosted.find((entry) => entry.ownerScenePlanId !== realScene.scenePlan.id);
                if (owner) {
                  // This card shows layers another scene owns: open the
                  // owner, narrowed to just the layers shown here.
                  setEditingMappingIds(hosted.filter((entry) => entry.ownerScenePlanId === owner.ownerScenePlanId).map((entry) => entry.mapping.id));
                  setEditingSceneId(owner.ownerScenePlanId);
                } else {
                  const shownIds = hosted.map((entry) => entry.mapping.id);
                  setEditingMappingIds(shownIds.length === realScene.scenePlan.mappings.length ? null : shownIds);
                  setEditingSceneId(realScene.scenePlan.id);
                }
              }}
              onRegeneratePreview={() => previewQueue.regenerate(realScene.scenePlan.id)}
              onAcceptSuggestion={(suggestion) => void handleAccept(suggestion)}
              onRejectSuggestion={(suggestion) => void handleReject(suggestion)}
              onAcceptSuggestions={(many) => void handleAcceptMany(many)}
              onKeepTemplateText={(mappingIds, findings) => void handleKeepTemplateText(mappingIds, findings)}
              templateTextOf={templateTextOf}
              onNoText={(mappingId) => void handleKeepTemplateText([mappingId], [], "NO_TEXT")}
            />
          ))}
        </div>
        </>
      )}
      {/*
        Parts of the template with nothing a client can change (a music
        track, a helper composition) are kept, but out of the way: they are
        not a step, and a wall of "nothing to change" cards hid the scenes
        that are.
      */}
      {quietCards.size > 0 ? (
        <details className="advanced-details simple-scenes__quiet">
          <summary>{t.simpleScenes.quietCardsToggle(quietCards.size)}</summary>
          <div className="simple-scenes__grid">
          {realScenes.filter((realScene) => quietCards.has(realScene.scenePlan.id)).map((realScene) => (
            <SceneCard
              key={realScene.manifestCompositionId}
              {...(cardLabels.has(realScene.scenePlan.id) ? { eyebrow: cardLabels.get(realScene.scenePlan.id)! } : {})}
              projectId={projectId}
              realScene={realScene}
              assets={assets}
              previewEntry={previewQueue.getEntry(realScene.scenePlan.id)}
              pendingSuggestions={pendingByScene.get(realScene.scenePlan.id) ?? []}
              suggestionsBusy={busySuggestionId !== null}
              quietActions={currentGuideStep !== GUIDE_LEFTOVER}
              cardMappings={(homes.mappingsByCardId.get(realScene.scenePlan.id) ?? []).map((hosted) => hosted.mapping)}
              needsConfirmation={cardsNeedingConfirmation.has(realScene.scenePlan.id)}
              // onEdit={() => setEditingSceneId(realScene.scenePlan.id)}
              onEdit={(focusMappingId) => {
                setFocusMappingId(focusMappingId ?? null);
                const hosted = homes.mappingsByCardId.get(realScene.scenePlan.id) ?? [];
                const owner = hosted.find((entry) => entry.ownerScenePlanId !== realScene.scenePlan.id);
                if (owner) {
                  // This card shows layers another scene owns: open the
                  // owner, narrowed to just the layers shown here.
                  setEditingMappingIds(hosted.filter((entry) => entry.ownerScenePlanId === owner.ownerScenePlanId).map((entry) => entry.mapping.id));
                  setEditingSceneId(owner.ownerScenePlanId);
                } else {
                  const shownIds = hosted.map((entry) => entry.mapping.id);
                  setEditingMappingIds(shownIds.length === realScene.scenePlan.mappings.length ? null : shownIds);
                  setEditingSceneId(realScene.scenePlan.id);
                }
              }}
              onRegeneratePreview={() => previewQueue.regenerate(realScene.scenePlan.id)}
              onAcceptSuggestion={(suggestion) => void handleAccept(suggestion)}
              onRejectSuggestion={(suggestion) => void handleReject(suggestion)}
              onAcceptSuggestions={(many) => void handleAcceptMany(many)}
              onKeepTemplateText={(mappingIds, findings) => void handleKeepTemplateText(mappingIds, findings)}
              templateTextOf={templateTextOf}
              onNoText={(mappingId) => void handleKeepTemplateText([mappingId], [], "NO_TEXT")}
            />
          ))}
          </div>
        </details>
      ) : null}

      <SceneEditDrawer
        scenePlanId={editingSceneId}
        onlyMappingIds={editingMappingIds}
        focusMappingId={focusMappingId}
        onClose={() => {
          setFocusMappingId(null);
          setEditingSceneId(null);
          setEditingMappingIds(null);
        }}
      />
    </>
  );
}
