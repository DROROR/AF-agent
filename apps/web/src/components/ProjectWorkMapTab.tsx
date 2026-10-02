"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { parseHttpWebsiteUrl, type ProjectBrandInputs, type ProjectResponse, type WorkMapEntry } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useWorkspaceMode } from "./WorkspaceModeProvider";
import { useWorkMap } from "../lib/use-work-map";
import { useProjectAssets } from "../lib/use-project-assets";
import { updateProjectBrandInputs } from "../lib/projects-api-client";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { ClaudeActionButton } from "./ui/ClaudeActionButton";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Skeleton } from "./ui/Skeleton";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { SimpleWorkMapPlanView } from "./SimpleWorkMapPlanView";
import { useLocale } from "./LocaleProvider";

interface RowForm {
  id?: string;
  sourceCompositionId: string;
  sourceReference: string;
  desiredAssetId: string;
  desiredText: string;
  assetTimestampSeconds: string;
  desiredDurationSeconds: string;
  instructions: string;
  /** Carried through untouched - the manual form has no field for it, and saving a row must never silently detach it from the layer it was written for. */
  targetPlaceholderId?: string | null;
}

function emptyRow(): RowForm {
  return {
    sourceCompositionId: "",
    sourceReference: "",
    desiredAssetId: "",
    desiredText: "",
    assetTimestampSeconds: "",
    desiredDurationSeconds: "",
    instructions: ""
  };
}

function toRowForm(entry: WorkMapEntry): RowForm {
  return {
    id: entry.id,
    sourceCompositionId: entry.sourceCompositionId ?? "",
    sourceReference: entry.sourceReference ?? "",
    desiredAssetId: entry.desiredAssetId ?? "",
    desiredText: entry.desiredText ?? "",
    assetTimestampSeconds: entry.assetTimestampSeconds !== null ? String(entry.assetTimestampSeconds) : "",
    desiredDurationSeconds: entry.desiredDurationSeconds !== null ? String(entry.desiredDurationSeconds) : "",
    instructions: entry.instructions ?? "",
    ...(entry.targetPlaceholderId !== undefined ? { targetPlaceholderId: entry.targetPlaceholderId } : {})
  };
}

function toEntry(row: RowForm): Omit<WorkMapEntry, "id"> & { id?: string } {
  const trimmedTimestamp = row.assetTimestampSeconds.trim();
  const trimmedDuration = row.desiredDurationSeconds.trim();
  return {
    ...(row.id ? { id: row.id } : {}),
    sourceCompositionId: row.sourceCompositionId.trim() === "" ? null : row.sourceCompositionId.trim(),
    sourceReference: row.sourceReference.trim() === "" ? null : row.sourceReference.trim(),
    desiredAssetId: row.desiredAssetId.trim() === "" ? null : row.desiredAssetId.trim(),
    desiredText: row.desiredText.trim() === "" ? null : row.desiredText.trim(),
    assetTimestampSeconds: trimmedTimestamp === "" ? null : Number(trimmedTimestamp),
    desiredDurationSeconds: trimmedDuration === "" ? null : Number(trimmedDuration),
    instructions: row.instructions.trim() === "" ? null : row.instructions.trim(),
    ...(row.targetPlaceholderId !== undefined ? { targetPlaceholderId: row.targetPlaceholderId } : {})
  };
}

/** Sent as the request when the client gave a website or a business description but typed nothing in the description box. Plain English on purpose - it is read by the model, never shown to a person. */
const DEFAULT_PLAN_REQUEST = "Plan a promo video for this business using the template's own scenes. Take the product name, the features and the tone from the business description and the website.";

/** A real plan call has taken 87-90 seconds; the bar fills over this long and then waits just short of full until the answer arrives - it never claims to be finished early. */
const EXPECTED_PLAN_SECONDS = 90;

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Covers the whole screen while the plan is being written: what is happening, how long it has been, how long it usually takes. */
function PlanProgressOverlay({ elapsedSeconds }: { elapsedSeconds: number }): ReactElement {
  const { t } = useLocale();
  const percent = Math.min(95, Math.round((elapsedSeconds / EXPECTED_PLAN_SECONDS) * 100));
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-overlay__panel">
        <h3 className="busy-overlay__title">{t.workMapTab.ai.progressTitle}</h3>
        <p className="busy-overlay__step">{t.workMapTab.ai.progressStep(elapsedSeconds)}</p>
        <div className="busy-overlay__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className="busy-overlay__bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="busy-overlay__time">{t.workMapTab.ai.progressElapsed(formatElapsed(elapsedSeconds))}</p>
        <p className="busy-overlay__hint">{t.workMapTab.ai.progressHint}</p>
      </div>
    </div>
  );
}

type VideoLanguage = "en" | "he" | "asWritten";

const VIDEO_LANGUAGE_KEY_PREFIX = "dyo.aiPlanVideoLanguage.";

/** Appended to what the client asked for. Plain English on purpose - read by the model, never shown to a person. */
const VIDEO_LANGUAGE_REQUEST: Record<VideoLanguage, string> = {
  en: "Write every on-screen text in English, whatever language these instructions or the business description are written in.",
  he: "Write every on-screen text in Hebrew, whatever language these instructions or the business description are written in.",
  asWritten: "Write the on-screen text in the same language the client wrote in."
};

function readVideoLanguage(projectId: string): VideoLanguage {
  try {
    const stored = window.localStorage.getItem(`${VIDEO_LANGUAGE_KEY_PREFIX}${projectId}`);
    return stored === "he" || stored === "asWritten" || stored === "en" ? stored : "en";
  } catch {
    return "en";
  }
}

const INSTRUCTIONS_DRAFT_KEY_PREFIX = "dyo.aiPlanDraft.";

/** Storage can be unavailable (private window, blocked site data) - then the draft is simply not remembered, never an error. */
function readInstructionsDraft(projectId: string): string {
  try {
    return window.localStorage.getItem(`${INSTRUCTIONS_DRAFT_KEY_PREFIX}${projectId}`) ?? "";
  } catch {
    return "";
  }
}

function writeInstructionsDraft(projectId: string, value: string): void {
  try {
    if (value === "") {
      window.localStorage.removeItem(`${INSTRUCTIONS_DRAFT_KEY_PREFIX}${projectId}`);
    } else {
      window.localStorage.setItem(`${INSTRUCTIONS_DRAFT_KEY_PREFIX}${projectId}`, value);
    }
  } catch {
    // Not remembered - nothing else changes.
  }
}

export function ProjectWorkMapTab(): ReactElement | null {
  const { project } = useProjectWorkspaceContext();

  if (!project) {
    return null;
  }

  return <WorkMapPanel project={project} />;
}

/**
 * Video-planning UX simplification, 2026-08-31 (CLAUDE.md-adjacent product
 * task, not a Mission-architecture change): three views over the SAME
 * real Work Map data/API this tab always had -
 * "tellAi" (default when no entries exist yet - the AI-first, plain-
 * English entry point), "planPreview" (a human-readable read of the
 * current entries: scene name, asset filename, text, duration - never raw
 * UUIDs), and "manualForm" (the original, still fully-supported free-form
 * editor, now with human-friendly asset/scene pickers instead of raw-ID
 * text inputs). Advanced/technical fields (composition ID, asset ID) are
 * never removed from the data model - "manualForm" and the plan preview's
 * own "Advanced details" disclosure keep them fully available, just not
 * required for the default experience.
 */
type ViewMode = "tellAi" | "planPreview" | "manualForm";

function WorkMapPanel({ project }: { project: ProjectResponse }): ReactElement {
  const projectId = project.project.projectId;
  const { t } = useLocale();
  const { mode } = useWorkspaceMode();
  const { plan, createPlan } = useProjectWorkspaceContext();
  const { workMap, isLoading, error, isStale, refetch, save, createAiDraft } = useWorkMap(projectId);
  const { assets } = useProjectAssets(projectId);
  const [rows, setRows] = useState<RowForm[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // const [instructions, setInstructions] = useState("");
  // What the client typed is kept in this browser per project, so a
  // refresh (every deploy asks for one) no longer silently empties it.
  const [instructions, setInstructionsState] = useState(() => readInstructionsDraft(project.project.projectId));
  function setInstructions(next: string): void {
    setInstructionsState(next);
    writeInstructionsDraft(project.project.projectId, next);
  }
  // The client's own website and business description. Seeded from the
  // project's already-persisted brand inputs, so they are typed once and
  // come back on every later visit.
  const [websiteUrl, setWebsiteUrl] = useState(project.project.brandInputs.websiteUrl ?? "");
  const [aboutClient, setAboutClient] = useState(project.project.brandInputs.textInstructions ?? "");
  const [brandInputsError, setBrandInputsError] = useState<string | null>(null);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [createPlanError, setCreatePlanError] = useState<string | null>(null);
  // Seconds since "Create Video Plan" was pressed - drives the full-screen
  // progress shown while the real AI call runs (a real one takes 60-90s,
  // and a small spinner on the button did not read as "working").
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // How long the last finished call really took - shown above the plan.
  const [lastPlanSeconds, setLastPlanSeconds] = useState<number | null>(null);
  const [nothingToPlanFrom, setNothingToPlanFrom] = useState(false);
  // The language of the words that will appear IN the video. Real surprise,
  // 2026-10-02: the business description was typed in Roman Urdu, so the
  // plan's on-screen lines came back in Roman Urdu. What a person types to
  // the assistant and what the video says are separate choices.
  const [videoLanguage, setVideoLanguageState] = useState<VideoLanguage>(() => readVideoLanguage(project.project.projectId));
  function setVideoLanguage(next: VideoLanguage): void {
    setVideoLanguageState(next);
    try {
      window.localStorage.setItem(`${VIDEO_LANGUAGE_KEY_PREFIX}${project.project.projectId}`, next);
    } catch {
      // Not remembered - nothing else changes.
    }
  }
  const instructionsRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isCreatingPlan) {
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [isCreatingPlan]);
  const [viewMode, setViewMode] = useState<ViewMode>("tellAi");
  const [hasEnteredPreviewOnce, setHasEnteredPreviewOnce] = useState(false);
  const [isApprovingPlan, setIsApprovingPlan] = useState(false);
  const [approvePlanError, setApprovePlanError] = useState<string | null>(null);

  // Reuses the EXACT same execution-plan-creation action SimpleScenesView's
  // own "Create Execution Plan" button already calls (client-facing UX
  // simplification follow-up, "Make the Review AI Plan action obvious") -
  // never a new approval mechanism. Once a plan already exists there is
  // nothing further to create here; the button becomes a plain link
  // forward to Match Your Content instead (see the render below).
  async function handleApprovePlan(): Promise<void> {
    setIsApprovingPlan(true);
    setApprovePlanError(null);
    const result = await createPlan();
    setIsApprovingPlan(false);
    if (!result.ok) {
      setApprovePlanError(result.message ?? null);
    }
  }

  useEffect(() => {
    // Synchronizes local editable rows from the real work map whenever it
    // (re)loads - same "derive editable state from an external value"
    // pattern as SceneEditDrawer.tsx's own effect, exempt from
    // react-hooks/set-state-in-effect for the same reason.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(workMap ? workMap.entries.map(toRowForm) : []);
  }, [workMap]);

  useEffect(() => {
    // A project that already has real Work Map entries (from a previous
    // AI draft, or a previous manual save) opens straight into the plan
    // preview - "Tell AI what you want" is only ever the FIRST thing a
    // normal user sees, never a return trip once a real plan exists.
    if (!isLoading && !hasEnteredPreviewOnce && workMap && workMap.entries.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewMode("planPreview");
      setHasEnteredPreviewOnce(true);
    }
  }, [isLoading, workMap, hasEnteredPreviewOnce]);

  const sceneNameByCompositionId = useMemo(() => new Map(project.manifest.compositions.map((composition) => [composition.compositionId, composition.name])), [project.manifest.compositions]);
  const assetById = useMemo(() => new Map((assets ?? []).map((asset) => [asset.id, asset])), [assets]);

  function resolveSceneName(entry: WorkMapEntry): string {
    if (entry.sourceCompositionId) {
      return sceneNameByCompositionId.get(entry.sourceCompositionId) ?? entry.sourceReference ?? entry.sourceCompositionId;
    }
    return entry.sourceReference ?? t.workMapTab.planPreview.noContent;
  }

  function resolveAssetLabel(entry: WorkMapEntry): string | null {
    if (!entry.desiredAssetId) {
      return null;
    }
    const asset = assetById.get(entry.desiredAssetId);
    return asset ? (asset.label ?? asset.originalFilename) : entry.desiredAssetId;
  }

  function updateRow(index: number, patch: Partial<RowForm>): void {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow(): void {
    setRows((current) => [...current, emptyRow()]);
  }

  function removeRow(index: number): void {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    const result = await save(rows.map(toEntry));
    setIsSaving(false);
    if (result.ok) {
      setViewMode("planPreview");
    } else {
      setSaveError(result.message ?? null);
    }
  }

  /** Empty is always allowed - these fields are optional. Anything else must be a real http(s) address, checked with the SAME function the API and the fetch allowlist use. */
  const websiteUrlIsUsable = websiteUrl.trim() === "" || parseHttpWebsiteUrl(websiteUrl) !== null;

  async function handleCreatePlan(): Promise<void> {
    // Was: a silent return (and a disabled button) whenever the description
    // was empty. A press that does nothing and says nothing is a dead end -
    // seen three times on 2026-10-02.
    // if (instructions.trim() === "" || !websiteUrlIsUsable) {
    //   return;
    // }
    if (!websiteUrlIsUsable) {
      return;
    }
    const hasAnythingToPlanFrom = instructions.trim() !== "" || aboutClient.trim() !== "" || websiteUrl.trim() !== "";
    if (!hasAnythingToPlanFrom) {
      setNothingToPlanFrom(true);
      instructionsRef.current?.focus();
      return;
    }
    setNothingToPlanFrom(false);
    const startedAt = Date.now();
    setElapsedSeconds(0);
    setIsCreatingPlan(true);
    setCreatePlanError(null);
    setBrandInputsError(null);

    // Saved BEFORE the draft is requested, because the draft reads these
    // values server-side from the persisted project - an unsaved website
    // would simply not be read. Replaces the whole object, per the API's
    // own contract, so the fields this card does not edit are carried
    // through unchanged rather than cleared.
    const nextWebsite = websiteUrl.trim() === "" ? null : websiteUrl.trim();
    const nextAbout = aboutClient.trim() === "" ? null : aboutClient.trim();
    const current = project.project.brandInputs;
    if (nextWebsite !== current.websiteUrl || nextAbout !== current.textInstructions) {
      const brandInputs: ProjectBrandInputs = { ...current, websiteUrl: nextWebsite, textInstructions: nextAbout };
      const saved = await updateProjectBrandInputs(projectId, brandInputs);
      if (!saved.ok) {
        setIsCreatingPlan(false);
        setBrandInputsError(saved.message ?? null);
        return;
      }
    }

    // A website or a business description is enough to plan from: the
    // description box is then optional, and this plain request stands in.
    // const result = await createAiDraft(instructions.trim());
    const request = instructions.trim() === "" ? DEFAULT_PLAN_REQUEST : instructions.trim();
    const result = await createAiDraft(`${request}\n\n${VIDEO_LANGUAGE_REQUEST[videoLanguage]}`);
    setLastPlanSeconds(Math.round((Date.now() - startedAt) / 1000));
    setIsCreatingPlan(false);
    if (result.ok) {
      setHasEnteredPreviewOnce(true);
      setViewMode("planPreview");
    } else {
      setCreatePlanError(result.message ?? null);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <Skeleton height="1.5rem" />
      </Card>
    );
  }

  if (error) {
    return <ErrorState title={t.projectWorkspace.loadErrorTitle} description={error} />;
  }

  if (isStale) {
    return (
      <Card>
        <ErrorState title={t.projectWorkspace.staleRevisionTitle} description={t.projectWorkspace.staleRevisionDescription} />
        <Button variant="secondary" size="sm" onClick={() => void refetch()}>
          {t.projectWorkspace.reload}
        </Button>
      </Card>
    );
  }

  if (viewMode === "tellAi") {
    return (
      <Card>
        <CardHeader title={t.workMapTab.ai.heading} />
        <p>{t.workMapTab.description}</p>
        {createPlanError ? <ErrorState title={t.workMapTab.ai.createPlanFailedTitle} description={createPlanError} /> : null}
        {brandInputsError ? <ErrorState title={t.workMapTab.ai.saveDetailsFailedTitle} description={brandInputsError} /> : null}
        <Field
          label={t.workMapTab.ai.websiteLabel}
          htmlFor="work-map-website-url"
          hint={t.workMapTab.ai.websiteHint}
          {...(websiteUrlIsUsable ? {} : { error: t.workMapTab.ai.websiteInvalid })}
        >
          <Input
            id="work-map-website-url"
            type="url"
            inputMode="url"
            placeholder={t.workMapTab.ai.websitePlaceholder}
            value={websiteUrl}
            disabled={isCreatingPlan}
            onChange={(event) => setWebsiteUrl(event.target.value)}
          />
        </Field>
        <Field label={t.workMapTab.ai.aboutClientLabel} htmlFor="work-map-about-client" hint={t.workMapTab.ai.aboutClientHint}>
          <textarea
            id="work-map-about-client"
            className="input"
            rows={3}
            placeholder={t.workMapTab.ai.aboutClientPlaceholder}
            value={aboutClient}
            disabled={isCreatingPlan}
            onChange={(event) => setAboutClient(event.target.value)}
          />
        </Field>
        <Field label={t.workMapTab.ai.textareaLabel} htmlFor="work-map-ai-instructions" hint={t.workMapTab.ai.exampleHint}>
          <textarea
            id="work-map-ai-instructions"
            className="input"
            rows={6}
            placeholder={t.workMapTab.ai.placeholder}
            ref={instructionsRef}
            value={instructions}
            disabled={isCreatingPlan}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
        <Field label={t.workMapTab.ai.videoLanguageLabel} htmlFor="work-map-ai-video-language" hint={t.workMapTab.ai.videoLanguageHint}>
          <Select id="work-map-ai-video-language" value={videoLanguage} disabled={isCreatingPlan} onChange={(event) => setVideoLanguage(event.target.value as VideoLanguage)}>
            <option value="en">{t.workMapTab.ai.videoLanguageEnglish}</option>
            <option value="he">{t.workMapTab.ai.videoLanguageHebrew}</option>
            <option value="asWritten">{t.workMapTab.ai.videoLanguageAsWritten}</option>
          </Select>
        </Field>
        <div className="edit-drawer-actions">
          <Button variant="secondary" disabled={isCreatingPlan} onClick={() => setViewMode("manualForm")}>
            {t.workMapTab.ai.addDetailsManually}
          </Button>
          <ClaudeActionButton
            label={t.workMapTab.ai.createPlanAction}
            busyLabel={t.workMapTab.ai.creatingPlan}
            busy={isCreatingPlan}
            // disabled={instructions.trim() === "" || !websiteUrlIsUsable}
            disabled={!websiteUrlIsUsable}
            onClick={() => void handleCreatePlan()}
          />
        </div>
        {/* {instructions.trim() === "" ? <p className="field__hint">{t.workMapTab.ai.needDescription}</p> : null} */}
        {nothingToPlanFrom ? (
          <p className="field__error" role="alert">
            {t.workMapTab.ai.needSomething}
          </p>
        ) : null}
        {isCreatingPlan ? <PlanProgressOverlay elapsedSeconds={elapsedSeconds} /> : null}
      </Card>
    );
  }

  if (viewMode === "planPreview") {
    const entries = workMap?.entries ?? [];
    const isSimple = mode === "simple";
    return (
      <Card>
        <CardHeader title={t.workMapTab.planPreview.title} />
        <p>{isSimple ? t.workMapTab.planPreview.simple.description : t.workMapTab.planPreview.description}</p>
        {lastPlanSeconds !== null ? <p className="field__hint">{t.workMapTab.ai.planTook(formatElapsed(lastPlanSeconds))}</p> : null}
        {entries.length === 0 ? (
          <EmptyState title={t.workMapTab.emptyTitle} description={t.workMapTab.emptyDescription} />
        ) : isSimple ? (
          <SimpleWorkMapPlanView manifest={project.manifest} entries={entries} assets={assets} onEditPlan={() => setViewMode("manualForm")} />
        ) : (
          <div className="work-map-plan-preview" role="table">
            <div className="work-map-plan-preview__header" role="row">
              <span role="columnheader">{t.workMapTab.planPreview.columns.scene}</span>
              <span role="columnheader">{t.workMapTab.planPreview.columns.content}</span>
              <span role="columnheader">{t.workMapTab.planPreview.columns.text}</span>
              <span role="columnheader">{t.workMapTab.planPreview.columns.duration}</span>
              <span role="columnheader">{t.workMapTab.planPreview.columns.action}</span>
            </div>
            {entries.map((entry) => {
              const assetLabel = resolveAssetLabel(entry);
              return (
                <div key={entry.id} className="work-map-plan-preview__row" role="row">
                  <span role="cell">{resolveSceneName(entry)}</span>
                  <span role="cell">{assetLabel ?? t.workMapTab.planPreview.noContent}</span>
                  <span role="cell">{entry.desiredText ?? t.workMapTab.planPreview.noContent}</span>
                  <span role="cell">{entry.desiredDurationSeconds !== null ? `${entry.desiredDurationSeconds}s` : t.workMapTab.planPreview.noContent}</span>
                  <span role="cell">
                    <Button size="sm" variant="ghost" onClick={() => setViewMode("manualForm")}>
                      {t.workMapTab.planPreview.editAction}
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/*
          Simple Mode never renders this - it exposes exactly the raw
          Work Map UUID / composition ID / desiredAssetId values Simple
          Mode must never show a client (live QA follow-up). Any real,
          client-facing AI instruction text now surfaces instead as a
          plain-language note on the relevant scene card (see
          SimpleWorkMapPlanView's own PlanCard). Advanced Mode is
          completely unchanged - still lists every entry, unfiltered.
        */}
        {isSimple ? null : (
          <details className="advanced-details">
            <summary>{t.workMapTab.planPreview.advancedDetailsToggle}</summary>
            {/*
              2026-09-27 non-developer audit: this list borrowed the FORM's
              field labels ("Scene in the template", "File to use") to label
              raw identifiers, which reads as though the identifier is the
              answer to the question the form asks. It now says what it is -
              support material - and labels each value for what it really is.
            */}
            <p className="field__hint">{t.workMapTab.planPreview.advancedDetailsHint}</p>
            <ul className="advanced-details__list">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <code>{entry.id}</code> · {t.workMapTab.planPreview.advancedCompositionIdLabel}: <code>{entry.sourceCompositionId ?? "null"}</code> ·{" "}
                  {t.workMapTab.planPreview.advancedAssetIdLabel}: <code>{entry.desiredAssetId ?? "null"}</code>
                </li>
              ))}
            </ul>
          </details>
        )}

        {isSimple && approvePlanError ? (
          <ErrorState title={t.workMapTab.planPreview.simple.approvePlanFailedTitle} description={approvePlanError} />
        ) : null}

        {isSimple && !plan ? <p className="field__hint">{t.workMapTab.planPreview.simple.approvePlanHelper}</p> : null}

        <div className="edit-drawer-actions">
          <Button variant="secondary" onClick={() => setViewMode("tellAi")}>
            {isSimple ? t.workMapTab.planPreview.simple.askAiToImproveAction : t.workMapTab.planPreview.tellAiAgainAction}
          </Button>
          {isSimple ? null : (
            <Button variant="secondary" onClick={() => setViewMode("manualForm")}>
              {t.workMapTab.ai.addDetailsManually}
            </Button>
          )}
          {isSimple ? (
            plan ? (
              <Link href={`/projects/${projectId}/scenes`} className="btn btn--primary">
                {t.workMapTab.planPreview.simple.continueToMappingAction}
              </Link>
            ) : (
              <Button variant="primary" disabled={isApprovingPlan} onClick={() => void handleApprovePlan()}>
                {isApprovingPlan ? t.workMapTab.planPreview.simple.approvingPlan : t.workMapTab.planPreview.simple.approvePlanAction}
              </Button>
            )
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={t.workMapTab.title} />
      <p>{t.workMapTab.description}</p>
      <p className="work-map-intro">{t.workMapTab.intro}</p>
      {saveError ? <ErrorState title={t.workMapTab.saveFailedTitle} description={saveError} /> : null}

      {rows.length === 0 ? (
        <EmptyState title={t.workMapTab.emptyTitle} description={t.workMapTab.emptyDescription} />
      ) : (
        <div className="work-map-rows">
          {rows.map((row, index) => (
            <fieldset key={row.id ?? `new-${index}`} className="work-map-row">
              <legend>{row.sourceReference || `#${index + 1}`}</legend>
              <Field label={t.workMapTab.fields.sourceReference} htmlFor={`wm-source-reference-${index}`}>
                <Input
                  id={`wm-source-reference-${index}`}
                  value={row.sourceReference}
                  onChange={(event) => updateRow(index, { sourceReference: event.target.value })}
                />
              </Field>
              <Field label={t.workMapTab.fields.sourceCompositionId} htmlFor={`wm-composition-${index}`} hint={t.workMapTab.fieldHints.sourceCompositionId}>
                <Select
                  id={`wm-composition-${index}`}
                  value={row.sourceCompositionId}
                  onChange={(event) => updateRow(index, { sourceCompositionId: event.target.value })}
                >
                  <option value="">{t.workMapTab.picker.sceneNoneOption}</option>
                  {project.manifest.compositions.map((composition) => (
                    <option key={composition.compositionId} value={composition.compositionId}>
                      {composition.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.workMapTab.fields.desiredAssetId} htmlFor={`wm-asset-${index}`} hint={t.workMapTab.fieldHints.desiredAssetId}>
                <Select id={`wm-asset-${index}`} value={row.desiredAssetId} onChange={(event) => updateRow(index, { desiredAssetId: event.target.value })}>
                  <option value="">{t.workMapTab.picker.assetNoneOption}</option>
                  {(assets ?? []).map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.label ?? asset.originalFilename}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.workMapTab.fields.desiredText} htmlFor={`wm-text-${index}`}>
                <Input id={`wm-text-${index}`} value={row.desiredText} onChange={(event) => updateRow(index, { desiredText: event.target.value })} />
              </Field>
              <Field label={t.workMapTab.fields.assetTimestampSeconds} htmlFor={`wm-timestamp-${index}`}>
                <Input
                  id={`wm-timestamp-${index}`}
                  type="number"
                  min="0"
                  step="0.1"
                  value={row.assetTimestampSeconds}
                  onChange={(event) => updateRow(index, { assetTimestampSeconds: event.target.value })}
                />
              </Field>
              <Field label={t.workMapTab.fields.desiredDurationSeconds} htmlFor={`wm-duration-${index}`}>
                <Input
                  id={`wm-duration-${index}`}
                  type="number"
                  min="0"
                  step="0.1"
                  value={row.desiredDurationSeconds}
                  onChange={(event) => updateRow(index, { desiredDurationSeconds: event.target.value })}
                />
              </Field>
              <Field label={t.workMapTab.fields.instructions} htmlFor={`wm-instructions-${index}`}>
                <textarea
                  id={`wm-instructions-${index}`}
                  className="input"
                  rows={2}
                  value={row.instructions}
                  onChange={(event) => updateRow(index, { instructions: event.target.value })}
                />
              </Field>
              <Button size="sm" variant="ghost" onClick={() => removeRow(index)}>
                {t.workMapTab.removeRow}
              </Button>
            </fieldset>
          ))}
        </div>
      )}

      <div className="edit-drawer-actions">
        <Button variant="ghost" onClick={() => setViewMode(hasEnteredPreviewOnce ? "planPreview" : "tellAi")}>
          {t.workMapTab.picker.backToSimpleView}
        </Button>
        <Button variant="secondary" onClick={addRow}>
          {t.workMapTab.addRow}
        </Button>
        <Button variant="primary" disabled={isSaving} onClick={() => void handleSave()}>
          {isSaving ? t.workMapTab.saving : t.workMapTab.save}
        </Button>
      </div>
    </Card>
  );
}
