"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { hasAepExtension, inspectTemplateResultSchema, type InspectTemplateResponse, type JobDto } from "@dyo/schemas";
import { PageHeader } from "./ui/PageHeader";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { StatusBadge } from "./StatusBadge";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "./ui/Skeleton";
import { useLocale } from "./LocaleProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { dispatchJob, fetchJobStatus, createProject } from "../lib/projects-api-client";

type StepId = "details" | "template";
const STEP_IDS: readonly StepId[] = ["details", "template"];

const TERMINAL_STATUSES = new Set<JobDto["status"]>(["SUCCEEDED", "FAILED", "CANCELLED"]);
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
  const canInspect =
    name.trim() !== "" &&
    workerReady &&
    templateId.trim() !== "" &&
    hasAepExtension(sourceProjectPath) &&
    !isDispatching &&
    (job === null || job.status === "FAILED");

  // Real 2026-09-11 incident fix: polls on a FIXED recurring interval that
  // always fires again regardless of whether the previous attempt
  // succeeded - never dependent on `job` changing to reschedule itself
  // (the old bug: one transient fetchJobStatus failure permanently stopped
  // all future polling, even though the job kept running server-side).
  // Only ever stops once a real terminal status is confirmed, or the
  // jobId itself changes/clears.
  const jobRef = useRef(job);
  jobRef.current = job;
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
  useEffect(() => {
    const draft = loadPendingJobDraft();
    if (!draft) return;
    setName(draft.name);
    setWorkerId(draft.workerId);
    setTemplateId(draft.templateId);
    setSourceProjectPath(draft.sourceProjectPath);
    setJobId(draft.jobId);
    setStepIndex(1);
    void fetchJobStatus(draft.jobId).then((result) => {
      if (result.ok) {
        setJob(result.data);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInspect(): Promise<void> {
    setIsDispatching(true);
    setDispatchError(null);
    setJob(null);
    setCreateProjectError(null);
    const result = await dispatchJob({
      operation: "INSPECT_TEMPLATE",
      workerId,
      payload: { templateId: templateId.trim(), sourceProjectPath: sourceProjectPath.trim() }
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
      sourceProjectPath: sourceProjectPath.trim(),
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
      payload: { templateId: templateId.trim(), sourceProjectPath: sourceProjectPath.trim() },
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
    window.location.href = `/projects/${result.data.projectId}`;
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
                >
                  <Input
                    id="inspect-source-path"
                    placeholder={t.projectsNew.template.sourceProjectPathPlaceholder}
                    value={sourceProjectPath}
                    onChange={(event) => setSourceProjectPath(event.target.value)}
                  />
                </Field>

                {dispatchError ? <ErrorState title={t.projectsNew.template.inspectionFailedTitle} description={dispatchError} /> : null}

                <div className="overview-actions">
                  <Button variant="primary" disabled={!canInspect} onClick={() => void handleInspect()}>
                    {isDispatching ? t.projectsNew.template.inspecting : job?.status === "FAILED" ? t.projectsNew.template.retryAction : t.projectsNew.template.inspectAction}
                  </Button>
                </div>

                {job && !TERMINAL_STATUSES.has(job.status) ? (
                  <div className="overview-section">
                    <Skeleton height="1.25rem" />
                    <p>
                      {job.status === "QUEUED"
                        ? t.projectsNew.template.statusQueued
                        : job.status === "CLAIMED"
                          ? t.projectsNew.template.statusClaimed
                          : job.status === "WAITING_FOR_ACTION"
                            ? t.projectsNew.template.statusWaiting
                            : t.projectsNew.template.statusRunning}
                    </p>
                  </div>
                ) : null}

                {job?.status === "FAILED" ? (
                  job.error?.message ? (
                    <ErrorState title={t.projectsNew.template.inspectionFailedTitle} description={job.error.message} />
                  ) : (
                    <ErrorState title={t.projectsNew.template.inspectionFailedTitle} />
                  )
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

                    {createProjectError ? <ErrorState title={t.projectsNew.template.createProjectFailedTitle} description={createProjectError} /> : null}

                    <div className="overview-actions">
                      <Button variant="primary" disabled={isCreatingProject || name.trim() === ""} onClick={() => void handleCreateProject()}>
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

      <div className="page-header__actions">
        <Button variant="secondary" onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={isFirst}>
          {t.common.back}
        </Button>
        {!isLast ? (
          <Button variant="primary" onClick={() => setStepIndex((i) => Math.min(STEP_IDS.length - 1, i + 1))} disabled={name.trim() === ""}>
            {t.common.next}
          </Button>
        ) : null}
      </div>
    </>
  );
}
