"use client";

import { Fragment, useEffect, useState, type ReactElement } from "react";
import type { JobDto } from "@dyo/schemas";
import { type ExecutionSessionDto, type RenderOutputConfig, type RenderOutputVariant } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { useWorkspaceMode } from "./WorkspaceModeProvider";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { LockedStepNotice } from "./LockedStepNotice";
import { useLocale } from "./LocaleProvider";
import { dispatchJob, fetchCurrentExecutionSession, fetchJobHistory, fetchJobStatus } from "../lib/projects-api-client";
import { BusyNotice } from "./ui/BusyNotice";
import { ProblemNotice } from "./ui/ProblemNotice";
import { useProjectGuidanceRefresh } from "./ProjectGuidanceProvider";

const TERMINAL_JOB_STATUSES = new Set<JobDto["status"]>(["SUCCEEDED", "FAILED", "CANCELLED"]);
const LIVE_JOB_STATUSES = new Set<string>(["QUEUED", "CLAIMED", "RUNNING"]);
/** A render takes minutes; asking every few seconds is plenty. */
const RENDER_POLL_INTERVAL_MS = 5_000;

/** Which output a RENDER job is for, read from the job's own payload - null when it does not say. */
function renderVariantOf(job: JobDto): string | null {
  const payload = job.payload;
  if (payload !== null && typeof payload === "object" && "variant" in payload) {
    const variant = (payload as { variant?: unknown }).variant;
    return typeof variant === "string" ? variant : null;
  }
  return null;
}
import { FinalOutputsCard, VariantConfigCard } from "./ProjectRenderSettingsTab";

/**
 * "Export" tab (final MVP nav, client-facing UX redesign section H,
 * finalized) - a plain-language render trigger plus the same real,
 * server-verified download/playback list Advanced's Render Settings tab
 * already shows (FinalOutputsCard, reused unchanged). Deliberately never
 * exposes the raw master-composition picker or the AE Render Settings/
 * Output Module TEMPLATE NAME fields (ProjectRenderSettingsTab's
 * VariantConfigCard) - configuring those stays an Advanced-only action;
 * this tab only ever dispatches RENDER against whatever configuration
 * already exists, exactly like every other dispatch in this codebase
 * (never accepts a composition/template field from the browser directly -
 * see resolve-render-dispatch.ts).
 *
 * THE DEAD END THIS TAB USED TO BE (fixed 2026-09-26). Rendering is
 * impossible until a master composition has been saved for an output, and
 * that could only ever be done on the Render Settings tab - which the
 * normal nav does not list. So the person arrived here, found the one
 * button they wanted greyed out, and the only instruction anywhere in the
 * product was "switch to Advanced view". The operator spent two days being
 * talked through that by phone.
 *
 * Now the setup form appears here, in place, for exactly the outputs that
 * are missing it (or whose saved choice no longer matches the current
 * template), and disappears the moment it is filled in. It is the SAME
 * component the Render Settings tab uses, imported - never a second form
 * writing the same row. Nothing was removed from Render Settings, and its
 * URL still works for anyone who wants the fuller view.
 */
export function ProjectExportTab(): ReactElement | null {
  const { t } = useLocale();
  const { project, plan } = useProjectWorkspaceContext();
  const { mode } = useWorkspaceMode();
  const [session, setSession] = useState<ExecutionSessionDto | null>(null);
  // Bumped when a render finishes, so the list of finished videos below is
  // read again and the new one appears by itself.
  const [outputsVersion, setOutputsVersion] = useState(0);
  const refreshGuidance = useProjectGuidanceRefresh();

  const projectIdForEffect = project?.project.projectId ?? null;
  useEffect(() => {
    if (!projectIdForEffect) {
      return;
    }
    let cancelled = false;
    void fetchCurrentExecutionSession(projectIdForEffect).then((result) => {
      if (!cancelled && result.ok) {
        setSession(result.data);
      }
    });
    // 2026-10-04: after "Approve Final Preview" this tab's lock and the blue
    // banner stayed as they were until a hard reload, although the server
    // already had the session ready to render. Arriving here re-reads the
    // state both are derived from.
    refreshGuidance();
    return () => {
      cancelled = true;
    };
  }, [projectIdForEffect, refreshGuidance]);

  if (!project) {
    return null;
  }

  if (!plan) {
    return mode === "simple" ? (
      <LockedStepNotice
        projectId={project.project.projectId}
        title={t.projectWorkspace.lockedStep.export.title}
        description={t.projectWorkspace.lockedStep.export.description}
      />
    ) : (
      <Card>
        <EmptyState title={t.projectWorkspace.noPlanTitle} description={t.projectWorkspace.noPlanDescription} />
      </Card>
    );
  }

  const projectId = project.project.projectId;
  // Same real gate resolve-render-dispatch.ts itself enforces server-side -
  // mirrored here only for UI honesty, never the actual enforcement.
  const renderReady = session !== null && (session.status === "READY_TO_RENDER" || session.status === "COMPLETED");

  const isSimple = mode === "simple";
  const sourceSha = project.manifest.sourceProject.sha256;
  const sectionFor = (variant: RenderOutputVariant): ReactElement => {
    const currentConfig = plan.plan.renderOutputs[variant] ?? null;
    // Exactly the condition SimpleExportVariantCard's own render gate
    // treats as "cannot render this" - so the fix is offered for, and
    // only for, the outputs that are genuinely blocked on it, and this
    // card vanishes by itself once a real, current choice is saved.
    const needsSetup = currentConfig === null || currentConfig.sourceProjectSha256 !== sourceSha;
    return (
      <Fragment key={variant}>
        <SimpleExportVariantCard
          projectId={projectId}
          variant={variant}
          currentConfig={currentConfig}
          currentSourceSha={sourceSha}
          session={session}
          renderReady={renderReady}
          onRendered={() => {
            setOutputsVersion((version) => version + 1);
            refreshGuidance();
          }}
        />
        {needsSetup ? (
          <VariantConfigCard
            projectId={projectId}
            variant={variant}
            compositions={project.manifest.compositions}
            currentConfig={currentConfig}
            currentSourceSha={sourceSha}
            session={session}
            renderReady={renderReady}
            showRenderAction={false}
          />
        ) : null}
      </Fragment>
    );
  };
  const variantSections: Record<RenderOutputVariant, ReactElement> = { LANDSCAPE: sectionFor("LANDSCAPE"), REELS: sectionFor("REELS") };
  const reelsAlreadySetUp = (plan.plan.renderOutputs.REELS ?? null) !== null;

  return (
    <div className="overview-grid">
      {/* Simple view: a card holding one sentence about the tab the person is already on said nothing and took a third of the row. */}
      {isSimple ? null : (
        <Card className="overview-section">
          <CardHeader title={t.projectWorkspace.tabs.export} />
          <p>{t.projectWorkspace.export.description}</p>
        </Card>
      )}

      {variantSections.LANDSCAPE}
      {isSimple ? (
        <>
          {/*
            2026-10-04: the list of finished videos sat at the very foot of
            the page, under the Reels card and its setup form. In Simple mode
            it sits directly under the video being made, and is read again
            the moment a render finishes - the empty state turns into the
            download without a reload.
          */}
          <FinalOutputsCard key={outputsVersion} projectId={projectId} />
          {/*
            2026-10-04: the Reels card and a "Reels master" setup form were
            drawn at full weight beside Landscape for a client with no
            interest in a tall video. Unless a tall version is already set
            up, it waits behind a closed disclosure - still one press away,
            and exactly the same card and form once opened.
          */}
          {reelsAlreadySetUp ? (
            variantSections.REELS
          ) : (
            <details className="advanced-details export-tab__reels">
              <summary>{t.projectWorkspace.export.reelsToggle}</summary>
              <div className="overview-grid">{variantSections.REELS}</div>
            </details>
          )}
        </>
      ) : (
        <>
          {variantSections.REELS}
          <FinalOutputsCard key={outputsVersion} projectId={projectId} />
        </>
      )}
    </div>
  );
}

function SimpleExportVariantCard({
  projectId,
  variant,
  currentConfig,
  currentSourceSha,
  session,
  renderReady,
  onRendered
}: {
  projectId: string;
  variant: RenderOutputVariant;
  currentConfig: RenderOutputConfig | null;
  currentSourceSha: string;
  session: ExecutionSessionDto | null;
  renderReady: boolean;
  /** A render of this output has just finished successfully. */
  onRendered: () => void;
}): ReactElement {
  const { t } = useLocale();
  const { mode } = useWorkspaceMode();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [isDispatching, setIsDispatching] = useState(false);
  // `kind` says at which point it went wrong, so Simple mode can say
  // something true: "job" ran on the editing computer and failed there (raw
  // worker text), "busy" is the editing computer doing something else,
  // "dispatch" is a refusal with a reason written for a person.
  const [dispatchError, setDispatchError] = useState<{ kind: "job" | "busy" | "dispatch"; message: string } | null>(null);
  // 2026-10-04: pressing Render showed "Started - this will update
  // automatically" and then nothing did - the page never looked at the job
  // again, so a render that took minutes (or failed) looked the same as one
  // that was never started, and a reload brought the button back. The job is
  // now watched from the press until it ends, found again in the job history
  // after a reload, and the finished video appears in the list below.
  const [rendering, setRendering] = useState<{ jobId: string; startedAt: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function findRunningRender(): Promise<void> {
      const history = await fetchJobHistory();
      if (cancelled || !history.ok) {
        return;
      }
      const candidates = history.data.jobs.filter((job) => job.projectId === projectId && job.operation === "RENDER" && LIVE_JOB_STATUSES.has(job.status));
      for (const candidate of candidates) {
        // The history row does not say which output a render is for; the job itself does.
        const job = await fetchJobStatus(candidate.jobId);
        if (cancelled) {
          return;
        }
        if (job.ok && renderVariantOf(job.data) === variant && !TERMINAL_JOB_STATUSES.has(job.data.status)) {
          setRendering((current) => current ?? { jobId: candidate.jobId, startedAt: candidate.createdAt });
          return;
        }
      }
    }
    void findRunningRender();
    return () => {
      cancelled = true;
    };
  }, [projectId, variant]);

  const renderingJobId = rendering?.jobId ?? null;
  useEffect(() => {
    if (renderingJobId === null) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick(): Promise<void> {
      const result = await fetchJobStatus(renderingJobId as string);
      if (cancelled) {
        return;
      }
      if (result.ok && TERMINAL_JOB_STATUSES.has(result.data.status)) {
        setRendering(null);
        if (result.data.status === "SUCCEEDED") {
          onRendered();
        } else {
          setDispatchError({ kind: "job", message: result.data.error?.message ?? `Job ${result.data.status.toLowerCase()}` });
        }
        return;
      }
      timer = setTimeout(() => void tick(), RENDER_POLL_INTERVAL_MS);
    }
    timer = setTimeout(() => void tick(), RENDER_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
    // onRendered is a fresh closure each render of the parent; the job id is what this watch is about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderingJobId]);

  const isStale = currentConfig !== null && currentConfig.sourceProjectSha256 !== currentSourceSha;
  // RENDER is always pinned to the execution session's own assigned worker
  // (worker affinity, section 8) - never re-chosen the way the very first
  // EXECUTE_FRAME dispatch is (same lookup ProjectRenderSettingsTab's own
  // VariantConfigCard uses - a plain find-by-id, never the generic
  // "any dispatchable worker" heuristic, since this always targets one
  // specific, already-pinned worker).
  const renderWorker = session ? (dashboardStatus?.workers ?? []).find((w) => w.workerId === session.assignedWorkerId) ?? null : null;
  const renderWorkerOnline = renderWorker !== null && renderWorker.status === "ONLINE" && renderWorker.currentJobId === null;
  const canRender = currentConfig !== null && !isStale && renderReady && renderWorkerOnline;
  const alreadyMade = mode === "simple" && session !== null && session.status === "COMPLETED" && !dispatchError;
  const isKnownWorkerOffline = renderWorker !== null && renderWorker.status !== "ONLINE";
  const variantLabel = t.renders.variantLabel[variant];
  // REAL 2026-09-25 INCIDENT: this render button has four independent
  // disabling conditions, and the most common one by far - no master
  // composition saved for this output - can only be cleared on the Render
  // Settings tab, which Simple Mode does not even show. The reason text
  // therefore has to name that tab, not just state the fact. Same order as
  // `canRender`'s own conjunction, so the stated reason is the real one.
  const renderDisabledReason = isDispatching
    ? t.projectWorkspace.disabledReason.working
    : currentConfig === null
      ? t.projectWorkspace.disabledReason.renderNotConfigured
      : isStale
        ? t.projectWorkspace.disabledReason.renderConfigStale
        : !renderReady
          ? t.projectWorkspace.disabledReason.renderNotReady
          : !renderWorkerOnline
            ? isKnownWorkerOffline
              ? t.projectWorkspace.disabledReason.workerOffline
              : t.projectWorkspace.disabledReason.noWorker
            : undefined;

  async function handleRender(): Promise<void> {
    if (!renderWorker || !session) {
      return;
    }
    if (rendering) {
      return;
    }
    setIsDispatching(true);
    setDispatchError(null);
    const result = await dispatchJob({
      operation: "RENDER",
      workerId: renderWorker.workerId,
      projectId,
      executionSessionId: session.id,
      variant
    });
    setIsDispatching(false);
    if (!result.ok) {
      setDispatchError({ kind: result.code === "WORKER_BUSY" ? "busy" : "dispatch", message: result.message });
      return;
    }
    setRendering({ jobId: result.data.jobId, startedAt: result.data.createdAt });
  }

  return (
    <Card className="overview-section">
      <CardHeader title={variantLabel} />

      {currentConfig === null || isStale ? (
        <EmptyState title={t.projectWorkspace.export.notConfiguredTitle} description={t.projectWorkspace.export.setUpBelowDescription} />
      ) : !renderReady ? (
        <EmptyState title={t.projectWorkspace.export.notReadyTitle} description={t.projectWorkspace.export.notReadyDescription} />
      ) : !renderWorkerOnline && !alreadyMade ? (
        // A finished video does not need the editing computer: its "offline"
        // box sat above "Your video is ready" as if something were wrong.
        isKnownWorkerOffline ? (
          <EmptyState title={t.jobDispatch.workerOfflineTitle} description={t.jobDispatch.workerOfflineDescription} />
        ) : (
          <EmptyState title={t.jobDispatch.noWorkerTitle} description={t.jobDispatch.noWorkerDescription} />
        )
      ) : null}
      {dispatchError ? (
        mode === "simple" ? (
          dispatchError.kind === "job" ? (
            <ProblemNotice title={t.projectWorkspace.export.renderFailedTitle(variantLabel)} description={t.projectWorkspace.export.renderFailedDescription} technicalDetails={dispatchError.message} />
          ) : dispatchError.kind === "busy" ? (
            <ProblemNotice title={t.projectWorkspace.export.renderNotStartedTitle} description={t.projectWorkspace.simplePreview.workerBusy} technicalDetails={dispatchError.message} />
          ) : (
            // A refusal to start carries a reason written for a person to act on - shown, not folded away.
            <ProblemNotice title={t.projectWorkspace.export.renderNotStartedTitle} description={dispatchError.message} />
          )
        ) : (
          <ErrorState title={t.jobDispatch.failedTitle} description={dispatchError.message} />
        )
      ) : null}

      {rendering ? (
        // Replaces the button for as long as it runs: nothing to press twice.
        <BusyNotice title={t.projectWorkspace.export.renderingTitle(variantLabel)} description={t.projectWorkspace.export.renderingDescription} startedAt={rendering.startedAt} />
      ) : (
        <div className="overview-actions">
          {/*
            2026-10-04 audit: with the finished video sitting right below, the
            one primary button on the page was still "Render Landscape" - a
            press that starts the whole render again. Once this session has
            completed, Simple view says the video is ready and offers making
            it again as a secondary action; the download is what stands out.
          */}
          {alreadyMade ? <p role="status">{t.projectWorkspace.export.alreadyMadeNote}</p> : null}
          <Button variant={alreadyMade ? "secondary" : "primary"} disabled={!canRender || isDispatching} disabledReason={renderDisabledReason} onClick={() => void handleRender()}>
            {isDispatching
              ? t.jobDispatch.dispatching
              : mode === "simple" && dispatchError
                ? t.projectWorkspace.simplePreview.tryAgainAction
                : alreadyMade
                  ? t.projectWorkspace.export.renderAgainAction
                  : t.projectWorkspace.export.renderAction(variantLabel)}
          </Button>
        </div>
      )}
    </Card>
  );
}
