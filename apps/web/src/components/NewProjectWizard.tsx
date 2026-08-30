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

  // Polls the real job while non-terminal - stops itself once
  // SUCCEEDED/FAILED/CANCELLED, and never starts a second overlapping poll
  // (guarded by the cleanup function below, same pattern as
  // use-dashboard-status.ts's own polling effect).
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!jobId || (job && TERMINAL_STATUSES.has(job.status))) {
      return;
    }
    let cancelled = false;
    pollingRef.current = setTimeout(async () => {
      const result = await fetchJobStatus(jobId);
      if (cancelled) return;
      if (result.ok) {
        setJob(result.data);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, [jobId, job]);

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
    const result = await createProject({ name: name.trim(), manifest: inspectionResult.manifest });
    setIsCreatingProject(false);
    if (!result.ok) {
      setCreateProjectError(result.message);
      return;
    }
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
