"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import Link from "next/link";
import {
  hasAepExtension,
  isDisposableCopyPath,
  inspectTemplateResultSchema,
  normalizeSourceProjectPath,
  type InspectTemplateResponse,
  type JobDto
} from "@dyo/schemas";
import { PageHeader } from "./ui/PageHeader";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { BusyNotice } from "./ui/BusyNotice";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { StatusBadge } from "./StatusBadge";
import { ErrorState } from "./ErrorState";
import { explainJobError } from "../lib/explain-job-error";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { dispatchJob, fetchJobStatus, createProject } from "../lib/projects-api-client";

type StepId = "details" | "template";
const STEP_IDS: readonly StepId[] = ["details", "template"];

const TERMINAL_STATUSES = new Set<JobDto["status"]>(["SUCCEEDED", "FAILED", "CANCELLED"]);
/**
 * Terminal statuses after which the operator must be able to inspect again.
 *
 * REAL 2026-09-13 INCIDENT: this used to allow re-inspecting only after
 * FAILED. The account's last wizard dispatch (df76c2be) was CANCELLED, and
 * because the wizard restores its in-flight job from localStorage on every
 * mount, that CANCELLED job disabled Inspect Template permanently - with no
 * message, and nothing in the UI able to clear it. A cancelled job never ran;
 * it is exactly as retryable as a failed one.
 */
const RETRYABLE_STATUSES = new Set<JobDto["status"]>(["FAILED", "CANCELLED"]);
const POLL_INTERVAL_MS = 2_000;

/**
 * Real 2026-09-11 incident fix: a genuinely long-running INSPECT_TEMPLATE
 * job (this one took ~18 minutes, a 51-composition manifest) exposed two
 * separate bugs, both fixed together below:
 *
 * 1. The polling effect only rescheduled its next check by relying on
 *    `job` state changing (see its own dependency array) - a single
 *    transient fetchJobStatus failure (network blip, tab backgrounded,
 *    anything) left `job` unchanged, which never re-triggered the effect,
 *    which silently stopped ALL future polling forever - even though the
 *    job kept running and eventually succeeded server-side. The dashboard
 *    was then stuck showing the loading skeleton indefinitely. Fixed by
 *    polling on a fixed recurring interval that always fires again
 *    regardless of whether the previous attempt succeeded, only ever
 *    stopping once a real terminal status is confirmed.
 * 2. Nothing about an in-flight or just-completed job survived a page
 *    refresh - all state lived in plain useState with no persistence, so
 *    a refresh reset the whole wizard to step 1 even though the job
 *    itself (and its full result) remained durably persisted server-side
 *    the entire time. Fixed by remembering the in-flight job's id (and
 *    the form fields that produced it) in localStorage, and restoring +
 *    immediately re-checking it on mount - this never re-dispatches a new
 *    INSPECT_TEMPLATE job, it only re-reads the existing one's real
 *    status/result via the same read-only fetchJobStatus call polling
 *    already uses.
 */
const PENDING_JOB_STORAGE_KEY = "dyo:new-project-wizard:pending-inspect-job";

interface PendingJobDraft {
  jobId: string;
  workerId: string;
  templateId: string;
  sourceProjectPath: string;
  name: string;
}

function savePendingJobDraft(draft: PendingJobDraft): void {
  try {
    window.localStorage.setItem(PENDING_JOB_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Best-effort only - localStorage can be unavailable (private mode, etc.). Losing resume-after-refresh is acceptable; crashing the wizard is not.
  }
}

function loadPendingJobDraft(): PendingJobDraft | null {
  try {
    const raw = window.localStorage.getItem(PENDING_JOB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingJobDraft>;
    if (
      typeof parsed.jobId === "string" &&
      typeof parsed.workerId === "string" &&
      typeof parsed.templateId === "string" &&
      typeof parsed.sourceProjectPath === "string" &&
      typeof parsed.name === "string"
    ) {
      return parsed as PendingJobDraft;
    }
    return null;
  } catch {
    return null;
  }
}

function clearPendingJobDraft(): void {
  try {
    window.localStorage.removeItem(PENDING_JOB_STORAGE_KEY);
  } catch {
    // Best-effort only, same as savePendingJobDraft above.
  }
}

/**
 * Real project intake: a dashboard operator picks a connected Worker,
 * dispatches a real INSPECT_TEMPLATE job against a copy of a real .aep,
 * watches its real progress, and - only once it SUCCEEDS - creates the
 * project from its real result (POST /api/projects, unchanged). No
 * curl/manual DB step anywhere in this flow. The other steps this wizard
 * used to show (work map, assets, scene table, review, render) were never
 * functional placeholders duplicating what the real per-project tabs
 * already do once a project exists - removed rather than kept disabled,
 * so this page never shows a control with no explanation for why it does
 * nothing (see NewProjectWizard's own git history for the fuller before/
 * after context).
 */
export function NewProjectWizard(): ReactElement {
  const { t } = useLocale();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [stepIndex, setStepIndex] = useState(0);
  const stepId = STEP_IDS[stepIndex] as StepId;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEP_IDS.length - 1;

  const [name, setName] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [sourceProjectPath, setSourceProjectPath] = useState("");

  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobDto | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);

  const eligibleWorkers = (dashboardStatus?.workers ?? []).filter((w) => w.capabilities.includes("INSPECT_TEMPLATE"));
  const selectedWorker = eligibleWorkers.find((w) => w.workerId === workerId) ?? null;
  const workerReady =
    selectedWorker !== null &&
    selectedWorker.status === "ONLINE" &&
    selectedWorker.aeAvailability === "ONLINE" &&
    selectedWorker.mcpAvailability === "ONLINE";
  /**
   * 2026-10-02: a leftover disposable inspection copy was pasted in as the
   * template source. It ends in .aep and really exists, so nothing refused
   * it, and the worker made a copy of the copy - a project built on it
   * would have anchored to a file that is deleted by design.
   *
   * Shown as a field error, never only as a disabled button: a button that
   * sits disabled with nothing on screen saying why is the exact failure
   * the 2026-09-28 Copy-as-path bug was reported as ("button he disable
   * hai"), and repeating it here would trade one silent dead end for
   * another.
   */
  const sourceProjectPathError =
    sourceProjectPath.trim() !== "" && isDisposableCopyPath(sourceProjectPath)
      ? t.projectsNew.template.sourceProjectPathDisposableCopy
      : null;

  const canInspect =
    name.trim() !== "" &&
    workerReady &&
    templateId.trim() !== "" &&
    hasAepExtension(sourceProjectPath) &&
    sourceProjectPathError === null &&
    !isDispatching &&
    (job === null || RETRYABLE_STATUSES.has(job.status));

  // Real 2026-09-11 incident fix: polls on a FIXED recurring interval that
  // always fires again regardless of whether the previous attempt
  // succeeded - never dependent on `job` changing to reschedule itself
  // (the old bug: one transient fetchJobStatus failure permanently stopped
  // all future polling, even though the job kept running server-side).
  // Only ever stops once a real terminal status is confirmed, or the
  // jobId itself changes/clears.
  const jobRef = useRef(job);
  // Synced in an effect, never during render: mutating a ref while
  // rendering is not safe under concurrent rendering (a render can be
  // thrown away and re-run, leaving the ref describing a render that never
  // committed). Declared BEFORE the polling effect below so that, in any
  // commit where both run, the ref is already current when the poll reads it.
  useEffect(() => {
    jobRef.current = job;
  }, [job]);
  useEffect(() => {
    if (!jobId) {
      return;
    }
    if (jobRef.current && TERMINAL_STATUSES.has(jobRef.current.status)) {
      return;
    }
    let cancelled = false;
    const intervalId = setInterval(async () => {
      const result = await fetchJobStatus(jobId);
      if (cancelled) return;
      if (result.ok) {
        setJob(result.data);
        if (TERMINAL_STATUSES.has(result.data.status)) {
          clearInterval(intervalId);
        }
      }
      // On failure, deliberately do nothing but let the interval fire
      // again on its own schedule - never let one bad poll stop every
      // future one.
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [jobId]);

  // Real 2026-09-11 incident fix: on mount, resume a job that was already
  // in flight (or already finished) before a page refresh discarded this
  // component's own in-memory state - never re-dispatches a new
  // INSPECT_TEMPLATE job, only re-reads the existing one's real status via
  // the same read-only fetchJobStatus call the polling effect above uses.
  //
  // The restore genuinely belongs in an effect rather than in lazy
  // useState initialisers: localStorage does not exist during Next.js's
  // server render, so seeding initial state from it would either crash on
  // the server or produce server/client HTML that disagrees. Restoring
  // after mount costs one extra render and is the hydration-safe option.
  useEffect(() => {
    const draft = loadPendingJobDraft();
    if (!draft) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see the hydration note above
    setName(draft.name);
    setWorkerId(draft.workerId);
    setTemplateId(draft.templateId);
    setSourceProjectPath(draft.sourceProjectPath);
    setJobId(draft.jobId);
    setStepIndex(1);
    void fetchJobStatus(draft.jobId).then((result) => {
      if (result.ok) {
        setJob(result.data);
        return;
      }
      // The remembered job no longer exists for this account (deleted, or not
      // this user's). Same stale-draft class as a CANCELLED job: forget it and
      // stop polling rather than polling a 404 forever. The restored form
      // fields are kept so the operator can simply inspect again.
      if (result.status === 404) {
        clearPendingJobDraft();
        setJobId(null);
      }
    });
  }, []);

  // A CANCELLED job never ran and has no result to resume, so there is nothing
  // for the remembered draft to restore on the next visit. Forget it the
  // moment that status is known, so a refresh can never re-lock the wizard.
  const jobStatus = job?.status;
  useEffect(() => {
    if (jobStatus === "CANCELLED") {
      clearPendingJobDraft();
    }
  }, [jobStatus]);

  async function handleInspect(): Promise<void> {
    setIsDispatching(true);
    setDispatchError(null);
    setJob(null);
    setCreateProjectError(null);
    const result = await dispatchJob({
      operation: "INSPECT_TEMPLATE",
      workerId,
      payload: { templateId: templateId.trim(), sourceProjectPath: normalizeSourceProjectPath(sourceProjectPath) }
    });
    setIsDispatching(false);
    if (!result.ok) {
      setDispatchError(result.message);
      return;
    }
    setJobId(result.data.jobId);
    savePendingJobDraft({
      jobId: result.data.jobId,
      workerId,
      templateId: templateId.trim(),
      sourceProjectPath: normalizeSourceProjectPath(sourceProjectPath),
      name: name.trim()
    });
    // Optimistic first snapshot from the dispatch response itself - the
    // poll above takes over from here.
    setJob({
      jobId: result.data.jobId,
      workerId: result.data.workerId,
      projectId: null,
      operation: "INSPECT_TEMPLATE",
      status: result.data.status,
      payload: { templateId: templateId.trim(), sourceProjectPath: normalizeSourceProjectPath(sourceProjectPath) },
      result: null,
      error: null,
      checkpoint: null,
      createdAt: result.data.createdAt,
      claimedAt: null,
      startedAt: null,
      completedAt: null,
      updatedAt: result.data.createdAt
    });
  }

  // The persisted INSPECT_TEMPLATE result is the full InspectTemplateResult
  // union - { kind: "manifest", response: {manifest, summary}, diagnostics }
  // or { kind: "raw_capture", ... } - never the bare {manifest, summary}
  // shape alone. Parsing job.result directly against
  // inspectTemplateResponseSchema (the old bug) always fails, even for a
  // genuinely valid manifest, because manifest/summary live one level
  // deeper, under .response. A job-dispatcher.ts fix means a real,
  // SUCCEEDED INSPECT_TEMPLATE job's result.kind is always "manifest" going
  // forward, but this still checks kind explicitly (never just casts)
  // rather than assuming that invariant for any job already in the
  // database or reported by an older worker build.
  const parsedInspectionResult = job?.status === "SUCCEEDED" ? inspectTemplateResultSchema.safeParse(job.result) : null;
  const inspectionResult: InspectTemplateResponse | null =
    parsedInspectionResult?.success && parsedInspectionResult.data.kind === "manifest" ? parsedInspectionResult.data.response : null;

  /**
   * REAL 2026-10-04: an inspection whose project-wide scan had failed was
   * shown like any other - "0 editable placeholders" in a list of numbers -
   * and was turned into a project in which nothing could be edited. The
   * worker attaches the scan's layer inventory to the job result only when
   * that scan completed, so its absence is the worker's own statement that
   * the layers were never read. Such a result cannot become a project.
   */
  const scanIncomplete =
    inspectionResult !== null && !(typeof job?.result === "object" && job.result !== null && "layerInventory" in job.result);

  /**
   * REAL 2026-09-28: a client's first two inspections failed, and all the
   * product told them was "Template inspection could not produce a valid
   * manifest." The actual reason was sitting in the job's own persisted
   * result the whole time:
   *
   *   Could not hash the real source .aep at sourceProjectPath (cannot
   *   access C:\...\Template.aep: ENOENT: no such file or directory)
   *
   * i.e. the path they typed does not exist - a thing they could have
   * fixed in ten seconds. job-dispatcher.ts deliberately PRESERVES the
   * whole RawInspectionCapture as the failed job's result "for
   * troubleshooting"; nothing was ever missing, it simply was not shown.
   *
   * So a failed inspection now reads its own capture and shows the note
   * beside the generic message. Read-only, no new endpoint, and nothing
   * on the worker changes - which matters, because the computer that hits
   * this is usually the one that has not been updated recently.
   */
  const failedCapture = job?.status === "FAILED" ? inspectTemplateResultSchema.safeParse(job.result) : null;
  const failureNote: string | null =
    failedCapture?.success && failedCapture.data.kind === "raw_capture" && failedCapture.data.note.trim() !== ""
      ? failedCapture.data.note
      : null;

  async function handleCreateProject(): Promise<void> {
    if (!inspectionResult) return;
    setIsCreatingProject(true);
    setCreateProjectError(null);
    // Worker affinity fix (live QA Blocker 1): job.workerId is the real
    // Worker whose successful INSPECT_TEMPLATE dispatch produced this exact
    // inspectionResult (set from the dispatch response itself, see
    // handleInspect above) - never the raw `workerId` dropdown state, which
    // could have been changed since that dispatch happened.
    const result = await createProject({ name: name.trim(), manifest: inspectionResult.manifest, sourceWorkerId: job?.workerId ?? null });
    setIsCreatingProject(false);
    if (!result.ok) {
      setCreateProjectError(result.message);
      return;
    }
    clearPendingJobDraft();
    // 2026-10-02: a brand-new project has no assets, so every per-scene asset
    // dropdown in the edit drawer is necessarily empty. Landing on the project
    // overview sent the client straight to scene review with nothing to
    // assign; Files is the one step that must come first.
    // Previously: window.location.href = `/projects/${result.data.projectId}`;
    window.location.href = `/projects/${result.data.projectId}/assets`;
  }

  return (
    <>
      <PageHeader title={t.projectsNew.title} description={t.projectsNew.description} />

      <div className="stepper" role="tablist" aria-label={t.projectsNew.stepperLabel}>
        {STEP_IDS.map((id, i) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={i === stepIndex}
            className="stepper__step"
            data-active={i === stepIndex}
            data-complete={i < stepIndex}
            onClick={() => setStepIndex(i)}
          >
            <span className="stepper__index">
              <span>{i + 1}</span>
            </span>
            {t.projectsNew.steps[id]}
          </button>
        ))}
      </div>

      <Card>
        {stepId === "details" ? (
          <div className="card-grid">
            <Field label={t.projectsNew.fields.projectName} htmlFor="project-name">
              <Input
                id="project-name"
                name="project-name"
                placeholder={t.projectsNew.fields.projectNamePlaceholder}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          </div>
        ) : (
          <>
            <CardHeader title={t.projectsNew.template.workerLabel} />
            {eligibleWorkers.length === 0 ? (
              <EmptyState title={t.projectsNew.template.noWorkersTitle} description={t.projectsNew.template.noWorkersDescription} />
            ) : (
              <>
                <Field label={t.projectsNew.template.workerLabel} htmlFor="inspect-worker">
                  <Select id="inspect-worker" value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
                    <option value="">{t.projectsNew.template.workerPlaceholder}</option>
                    {eligibleWorkers.map((w) => (
                      <option key={w.workerId} value={w.workerId}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {selectedWorker ? (
                  <dl className="detail-list">
                    <div className="detail-list__row">
                      <dt className="detail-list__label">{t.projectsNew.template.workerStatusLabel}</dt>
                      <dd className="detail-list__value">
                        <StatusBadge status={selectedWorker.status} />
                      </dd>
                    </div>
                    <div className="detail-list__row">
                      <dt className="detail-list__label">{t.projectsNew.template.aeStatusLabel}</dt>
                      <dd className="detail-list__value">
                        <StatusBadge status={selectedWorker.aeAvailability} />
                      </dd>
                    </div>
                    <div className="detail-list__row">
                      <dt className="detail-list__label">{t.projectsNew.template.mcpStatusLabel}</dt>
                      <dd className="detail-list__value">
                        <StatusBadge status={selectedWorker.mcpAvailability} />
                      </dd>
                    </div>
                  </dl>
                ) : null}

                <Field label={t.projectsNew.template.templateIdLabel} htmlFor="inspect-template-id">
                  <Input id="inspect-template-id" placeholder={t.projectsNew.template.templateIdPlaceholder} value={templateId} onChange={(event) => setTemplateId(event.target.value)} />
                </Field>
                <Field
                  label={t.projectsNew.template.sourceProjectPathLabel}
                  htmlFor="inspect-source-path"
                  hint={t.projectsNew.template.sourceProjectPathHint}
                  {...(sourceProjectPathError === null ? {} : { error: sourceProjectPathError })}
                >
                  <Input
                    id="inspect-source-path"
                    placeholder={t.projectsNew.template.sourceProjectPathPlaceholder}
                    value={sourceProjectPath}
                    onChange={(event) => setSourceProjectPath(event.target.value)}
                  />
                </Field>

                {dispatchError ? <ErrorState title={t.projectsNew.template.inspectionFailedTitle} description={dispatchError} /> : null}
                {job?.status === "CANCELLED" ? (
                  <p role="status" className="field__hint">
                    {t.projectsNew.template.previousInspectionCancelled}
                  </p>
                ) : null}

                <div className="overview-actions">
                  <Button variant="primary" disabled={!canInspect} onClick={() => void handleInspect()}>
                    {isDispatching ? t.projectsNew.template.inspecting : job !== null && RETRYABLE_STATUSES.has(job.status) ? t.projectsNew.template.retryAction : t.projectsNew.template.inspectAction}
                  </Button>
                </div>

                {/*
                  2026-10-04: a template inspection runs for about five
                  minutes, and all it showed was a shimmering bar over one
                  line. It now says which stage it is at, how long it has been
                  going (from the job's own start, so a reload does not reset
                  the clock), and that the result arrives by itself.
                */}
                {isDispatching && !job ? <BusyNotice compact title={t.projectsNew.template.inspecting} /> : null}
                {job && !TERMINAL_STATUSES.has(job.status) ? (
                  <BusyNotice
                    title={
                      job.status === "QUEUED"
                        ? t.projectsNew.template.statusQueued
                        : job.status === "CLAIMED"
                          ? t.projectsNew.template.statusClaimed
                          : job.status === "WAITING_FOR_ACTION"
                            ? t.projectsNew.template.statusWaiting
                            : t.projectsNew.template.statusRunning
                    }
                    description={t.projectsNew.template.inspectionBusyHint}
                    startedAt={job.createdAt}
                  />
                ) : null}

                {job?.status === "FAILED" ? (
                  <>
                    {job.error?.message ? (
                      <ErrorState title={t.projectsNew.template.inspectionFailedTitle} description={job.error.message} />
                    ) : (
                      <ErrorState title={t.projectsNew.template.inspectionFailedTitle} />
                    )}
                    {/* What the worker actually reported, which the generic
                        message above replaces. Shown verbatim: it names the
                        real path and the real reason. */}
                    {failureNote ? <p className="state-panel__description">{failureNote}</p> : null}
                    {/* Inspecting a template is the first thing anyone does
                        on a new editing computer, so it is the first place a
                        worker older than this server shows up. The raw
                        reason stays above; this only adds what to do. */}
                    {explainJobError(job.error?.message) === "WORKER_BEHIND_SERVER" ? (
                      <p className="state-panel__description">{t.jobs.explanation.WORKER_BEHIND_SERVER}</p>
                    ) : null}
                  </>
                ) : null}

                {inspectionResult ? (
                  <div className="overview-section">
                    <CardHeader title={t.projectsNew.template.resultTitle} />
                    <dl className="overview-fact-list">
                      <div>
                        <dt>{t.projectsNew.template.resultCompositions}</dt>
                        <dd>{inspectionResult.summary.compositionCount}</dd>
                      </div>
                      <div>
                        <dt>{t.projectsNew.template.resultScenes}</dt>
                        <dd>{inspectionResult.summary.candidateSceneCount}</dd>
                      </div>
                      <div>
                        <dt>{t.projectsNew.template.resultPlaceholders}</dt>
                        <dd>{inspectionResult.summary.editablePlaceholderCount}</dd>
                      </div>
                      <div>
                        <dt>{t.projectsNew.template.resultNested}</dt>
                        <dd>{inspectionResult.summary.nestedCompositionCount}</dd>
                      </div>
                      <div>
                        <dt>{t.projectsNew.template.resultFonts}</dt>
                        <dd>{inspectionResult.summary.requiredFontCount}</dd>
                      </div>
                      <div>
                        <dt>{t.projectsNew.template.resultFootage}</dt>
                        <dd>{inspectionResult.summary.footageReferencedCount}</dd>
                      </div>
                      <div>
                        <dt>{t.projectsNew.template.resultMissingFootage}</dt>
                        <dd>{inspectionResult.summary.missingFootageCount}</dd>
                      </div>
                      <div>
                        <dt>{t.projectsNew.template.resultPlugins}</dt>
                        <dd>{inspectionResult.summary.pluginReferenceCount}</dd>
                      </div>
                      <div>
                        <dt>{t.projectsNew.template.resultUnknown}</dt>
                        <dd>{inspectionResult.summary.unknownItemCount}</dd>
                      </div>
                    </dl>

                    {scanIncomplete ? (
                      <ErrorState title={t.projectsNew.template.scanIncompleteTitle} description={t.projectsNew.template.scanIncompleteDescription} />
                    ) : null}
                    {createProjectError ? <ErrorState title={t.projectsNew.template.createProjectFailedTitle} description={createProjectError} /> : null}

                    <div className="overview-actions">
                      <Button variant="primary" disabled={isCreatingProject || name.trim() === "" || scanIncomplete} onClick={() => void handleCreateProject()}>
                        {isCreatingProject ? t.projectsNew.template.creatingProject : t.projectsNew.template.createProjectAction}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </Card>

      {/*
        2026-10-07: on the first step "Back" was a dead, greyed button and "Next"
        was greyed with no word about why. On the first step Back now leaves the
        wizard (to the projects list - the only place back from here), and a
        waiting Next says what it waits for.
      */}
      <div className="page-header__actions">
        {isFirst ? (
          <Link href="/projects" className="btn btn--secondary">
            {t.common.back}
          </Link>
        ) : (
          <Button variant="secondary" onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>
            {t.common.back}
          </Button>
        )}
        {!isLast ? (
          <Button
            variant="primary"
            onClick={() => setStepIndex((i) => Math.min(STEP_IDS.length - 1, i + 1))}
            disabled={name.trim() === ""}
            disabledReason={name.trim() === "" ? t.projectsNew.fields.projectNameNeeded : undefined}
          >
            {t.common.next}
          </Button>
        ) : null}
      </div>
    </>
  );
}
