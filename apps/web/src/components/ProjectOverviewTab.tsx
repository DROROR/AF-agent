"use client";

import { useEffect, useState, type ReactElement } from "react";
import { getExecutionPlanReadiness, type ExecutionSessionDto, type ExecutionSessionStatus, type FullPreviewArtifactDto } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { PlanStatusBadge } from "./PlanStatusBadge";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { VideoArtifactPlayer } from "./ui/VideoArtifactPlayer";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";
import {
  dispatchJob,
  createExecutionSession,
  fetchCurrentExecutionSession,
  approveFirstPreview,
  rejectFirstPreview,
  executionSessionPreviewUrl,
  fetchFullPreviewStatus,
  fullPreviewFileUrl,
  approveFinalPreview,
  requestFinalPreviewChanges
} from "../lib/projects-api-client";
import { findDispatchableWorker } from "../lib/find-dispatchable-worker";

/**
 * Real Overview tab (dashboard-integration task section 4) - every value
 * here comes from the real project/execution-plan API responses already
 * loaded by ProjectWorkspaceProvider. Approval readiness uses
 * getExecutionPlanReadiness from @dyo/schemas - the SAME shared predicate
 * approve-execution-plan.ts enforces server-side, so this UI can never
 * claim a plan is ready when the backend would actually refuse it (and
 * vice versa). The "Approve plan" button is disabled whenever it isn't
 * ready, with the reason shown - never a silently-disabled button with no
 * explanation - but this is a UX convenience, not the enforcement: a
 * direct API call is independently refused with PRECONDITION_NOT_MET.
 */
function sessionStatusLabel(t: ReturnType<typeof useLocale>["t"], status: ExecutionSessionStatus): string {
  switch (status) {
    case "PREPARING":
      return t.projectWorkspace.overview.sessionStatusPreparing;
    case "EDITING":
      return t.projectWorkspace.overview.sessionStatusEditing;
    case "AWAITING_PREVIEW_APPROVAL":
      return t.projectWorkspace.overview.sessionStatusAwaitingPreviewApproval;
    case "READY_TO_RENDER":
      return t.projectWorkspace.overview.sessionStatusReadyToRender;
    case "RENDERING":
      return t.projectWorkspace.overview.sessionStatusRendering;
    case "COMPLETED":
      return t.projectWorkspace.overview.sessionStatusCompleted;
    case "PAUSED":
      return t.projectWorkspace.overview.sessionStatusPaused;
    case "FAILED":
      return t.projectWorkspace.overview.sessionStatusFailed;
  }
}

export function ProjectOverviewTab(): ReactElement | null {
  const { t } = useLocale();
  const { project, plan, approve, reject, reopen, isStale, refetch } = useProjectWorkspaceContext();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [session, setSession] = useState<ExecutionSessionDto | null>(null);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);

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
    return () => {
      cancelled = true;
    };
  }, [projectIdForEffect, sessionRefreshKey]);

  if (!project) {
    // Unreachable in practice - ProjectWorkspaceShell only renders tab
    // children once `project` has loaded - but typed defensively since
    // this component reads the same shared context independently.
    return null;
  }

  if (!plan) {
    return (
      <Card>
        <EmptyState title={t.projectWorkspace.noPlanTitle} description={t.projectWorkspace.noPlanDescription} />
      </Card>
    );
  }

  const projectId = project.project.projectId;
  const readiness = getExecutionPlanReadiness(plan.plan.scenePlans);
  const mappingCount = plan.plan.scenePlans.reduce((sum, scene) => sum + scene.mappings.length, 0);
  const isReady = readiness.ready && plan.plan.status === "DRAFT";

  async function runAction(action: () => Promise<{ ok: boolean; message?: string }>): Promise<void> {
    setIsSubmitting(true);
    setActionError(null);
    const result = await action();
    if (!result.ok) {
      setActionError(result.message ?? null);
    }
    setIsSubmitting(false);
  }

  // A FAILED session is terminal (multi-scene-accumulation phase, section
  // 11) - this card treats it exactly like "no session yet" for its own
  // button logic (offer to start a fresh one), while still SHOWING the
  // failure so the operator understands why (see the status line below).
  const activeSession = session && session.status !== "FAILED" ? session : null;

  const requiredScenePlanIds =
    plan.plan.status === "APPROVED"
      ? plan.plan.scenePlans.filter((scene) => scene.use && scene.approvalState === "APPROVED" && scene.unresolvedReasons.length === 0).map((s) => s.id)
      : [];
  const nextScenePlanId =
    requiredScenePlanIds.find((id) => !(activeSession?.completedScenePlanIds ?? []).includes(id)) ?? null;
  const allScenesComplete = activeSession !== null && requiredScenePlanIds.length > 0 && nextScenePlanId === null;

  // No session yet (or the last one FAILED): the browser picks a worker via
  // the same non-authoritative heuristic used elsewhere. Once a session
  // exists, every further dispatch is pinned to ITS OWN assignedWorkerId -
  // never re-chosen (section 8: worker affinity).
  const candidateWorker = activeSession
    ? (dashboardStatus?.workers ?? []).find((w) => w.workerId === activeSession.assignedWorkerId) ?? null
    : findDispatchableWorker(dashboardStatus?.workers ?? null, "EXECUTE_FRAME");
  const workerReady = activeSession ? candidateWorker !== null && candidateWorker.status === "ONLINE" && candidateWorker.currentJobId === null : candidateWorker !== null;
  const canExecute = nextScenePlanId !== null && workerReady;
  // A session pins a specific worker (worker affinity, section 8) - if that
  // worker is offline this is a known, specific worker being unreachable,
  // not "no worker was ever found" - a more honest, actionable message than
  // the generic no-worker-available one.
  const isKnownWorkerOffline = activeSession !== null && candidateWorker !== null && candidateWorker.status !== "ONLINE";

  async function handleExecuteNextScene(): Promise<void> {
    if (!nextScenePlanId || !candidateWorker) {
      return;
    }
    setIsDispatching(true);
    setDispatchError(null);
    setDispatchSuccess(null);

    let targetSession = activeSession;
    if (!targetSession) {
      const created = await createExecutionSession(projectId, candidateWorker.workerId);
      if (!created.ok) {
        setIsDispatching(false);
        setDispatchError(created.message);
        return;
      }
      targetSession = created.data;
      setSession(created.data);
    }

    const result = await dispatchJob({
      operation: "EXECUTE_FRAME",
      workerId: targetSession.assignedWorkerId,
      projectId,
      executionSessionId: targetSession.id,
      scenePlanId: nextScenePlanId
    });
    setIsDispatching(false);
    if (!result.ok) {
      setDispatchError(result.message);
      return;
    }
    setDispatchSuccess(t.jobDispatch.queuedDescription(result.data.jobId));
    setSessionRefreshKey((k) => k + 1);
  }

  async function handleApprovePreview(): Promise<void> {
    if (!activeSession) {
      return;
    }
    setIsDispatching(true);
    setDispatchError(null);
    setDispatchSuccess(null);
    const result = await approveFirstPreview(projectId, activeSession.id);
    setIsDispatching(false);
    if (!result.ok) {
      setDispatchError(result.message);
      return;
    }
    setSession(result.data);
  }

  async function handleRejectPreview(): Promise<void> {
    if (!activeSession) {
      return;
    }
    setIsDispatching(true);
    setDispatchError(null);
    setDispatchSuccess(null);
    const result = await rejectFirstPreview(projectId, activeSession.id);
    setIsDispatching(false);
    if (!result.ok) {
      setDispatchError(result.message);
      return;
    }
    setSession(result.data);
  }

  return (
    <div className="overview-grid">
      <Card className="overview-section">
        <CardHeader title={t.projectWorkspace.overview.projectSection} />
        <dl className="overview-fact-list">
          <div>
            <dt>{t.projectWorkspace.header.sourceProject}</dt>
            <dd>{project.manifest.sourceProject.name}</dd>
          </div>
          <div>
            <dt>{t.projectWorkspace.header.sourceSha}</dt>
            <dd>
              <code>{project.manifest.sourceProject.sha256.slice(0, 12)}</code>
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="overview-section">
        <CardHeader title={t.projectWorkspace.overview.planSection} action={<PlanStatusBadge status={plan.plan.status} />} />
        <dl className="overview-fact-list">
          <div>
            <dt>{t.projectWorkspace.header.revision}</dt>
            <dd>{plan.plan.revision}</dd>
          </div>
          <div>
            <dt>{t.projectWorkspace.header.scenes}</dt>
            <dd>{plan.plan.scenePlans.length}</dd>
          </div>
          <div>
            <dt>{t.projectWorkspace.header.unresolved}</dt>
            <dd>{readiness.unresolvedSceneCount}</dd>
          </div>
          <div>
            <dt>{t.projectWorkspace.overview.mappingCount}</dt>
            <dd>{mappingCount}</dd>
          </div>
        </dl>
      </Card>

      <Card className="overview-section">
        <CardHeader title={t.projectWorkspace.overview.safetySection} />
        <dl className="overview-fact-list">
          <div>
            <dt>{t.projectWorkspace.overview.approvedLabel}</dt>
            <dd>
              {plan.plan.status === "APPROVED"
                ? plan.plan.approvedAt
                  ? t.projectWorkspace.overview.approvedByAt(plan.plan.approvedBy ?? "—", new Date(plan.plan.approvedAt).toLocaleString())
                  : t.projectWorkspace.overview.approvedLabel
                : t.projectWorkspace.overview.notApprovedLabel}
            </dd>
          </div>
        </dl>
        <p className="overview-section__ready-title">
          {isReady ? t.projectWorkspace.overview.readyTitle : t.projectWorkspace.overview.notReadyTitle}
        </p>
        {!isReady && plan.plan.status === "DRAFT" ? (
          <>
            <p>{t.projectWorkspace.overview.blockedReasonsIntro}</p>
            <ul className="overview-blocked-reasons">
              {readiness.unresolvedSceneCount > 0 ? <li>{t.projectWorkspace.overview.unresolvedScenesReason(readiness.unresolvedSceneCount)}</li> : null}
            </ul>
          </>
        ) : null}

        {isStale ? (
          <ErrorState title={t.projectWorkspace.staleRevisionTitle} description={t.projectWorkspace.staleRevisionDescription} />
        ) : null}
        {isStale ? (
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            {t.projectWorkspace.reload}
          </Button>
        ) : null}
        {actionError ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={actionError} /> : null}

        <div className="overview-actions">
          {plan.plan.status === "DRAFT" ? (
            <Button variant="primary" disabled={!isReady || isSubmitting} onClick={() => void runAction(approve)}>
              {t.projectWorkspace.overview.approveAction}
            </Button>
          ) : null}
          {plan.plan.status === "DRAFT" ? (
            <Button variant="secondary" disabled={isSubmitting} onClick={() => void runAction(reject)}>
              {t.projectWorkspace.overview.rejectAction}
            </Button>
          ) : null}
          {plan.plan.status !== "DRAFT" ? (
            <Button variant="secondary" disabled={isSubmitting} onClick={() => void runAction(reopen)}>
              {t.projectWorkspace.overview.reopenAction}
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="overview-section">
        <CardHeader title={t.projectWorkspace.overview.executionSection} />
        {session ? (
          <dl className="overview-fact-list">
            <div>
              <dt>{t.projectWorkspace.overview.sessionStatusLabel}</dt>
              <dd>{sessionStatusLabel(t, session.status)}</dd>
            </div>
            <div>
              <dt>{t.projectWorkspace.overview.sessionWorkerLabel}</dt>
              <dd>{(dashboardStatus?.workers ?? []).find((w) => w.workerId === session.assignedWorkerId)?.name ?? session.assignedWorkerId}</dd>
            </div>
            <div>
              <dt>{t.projectWorkspace.header.scenes}</dt>
              <dd>{t.projectWorkspace.overview.sessionProgressLabel(session.completedScenePlanIds.length, requiredScenePlanIds.length)}</dd>
            </div>
          </dl>
        ) : null}

        {requiredScenePlanIds.length === 0 ? (
          <EmptyState title={t.projectWorkspace.overview.noApprovedSceneTitle} description={t.projectWorkspace.overview.noApprovedSceneDescription} />
        ) : !workerReady && !allScenesComplete ? (
          isKnownWorkerOffline ? (
            <EmptyState title={t.jobDispatch.workerOfflineTitle} description={t.jobDispatch.workerOfflineDescription} />
          ) : (
            <EmptyState title={t.jobDispatch.noWorkerTitle} description={t.jobDispatch.noWorkerDescription} />
          )
        ) : null}
        {dispatchError ? <ErrorState title={t.jobDispatch.failedTitle} description={dispatchError} /> : null}
        {dispatchSuccess ? <p role="status">{dispatchSuccess}</p> : null}

        {allScenesComplete ? <p role="status">{t.projectWorkspace.overview.allScenesCompleteLabel}</p> : null}

        {session?.hasPreview ? (
          // A same-origin, authenticated API route byte stream, not a static asset next/image could optimize.
          <img
            src={executionSessionPreviewUrl(projectId, session.id)}
            alt={t.projectWorkspace.overview.previewImageAlt}
            style={{ maxWidth: "100%", borderRadius: "8px", marginBlock: "0.75rem" }}
          />
        ) : null}

        <div className="overview-actions">
          {activeSession?.status === "AWAITING_PREVIEW_APPROVAL" ? (
            <>
              <Button variant="primary" disabled={isDispatching} onClick={() => void handleApprovePreview()}>
                {isDispatching ? t.jobDispatch.dispatching : t.projectWorkspace.overview.approvePreviewAction}
              </Button>
              <Button variant="secondary" disabled={isDispatching} onClick={() => void handleRejectPreview()}>
                {t.projectWorkspace.overview.rejectPreviewAction}
              </Button>
            </>
          ) : !allScenesComplete ? (
            <Button variant="primary" disabled={!canExecute || isDispatching} onClick={() => void handleExecuteNextScene()}>
              {isDispatching
                ? t.jobDispatch.dispatching
                : activeSession
                  ? t.projectWorkspace.overview.continueExecutionAction
                  : t.projectWorkspace.overview.startExecutionAction}
            </Button>
          ) : null}
        </div>
      </Card>

      {allScenesComplete && activeSession ? <FinalPreviewCard projectId={projectId} session={activeSession} /> : null}
    </div>
  );
}

/**
 * "Final Preview" (client-handoff phase, "real final preview approval
 * gate") - only reachable once every approved scene has completed
 * (allScenesComplete, computed by the parent from the same real session/
 * plan state RENDER dispatch itself checks). Renders the REAL complete-
 * preview artifact via the authenticated video player - never a fake
 * placeholder - and requires an explicit "Approve Final Preview" click
 * before the final render becomes available (enforced server-side by
 * resolve-render-dispatch.ts regardless of anything this component does).
 */
function FinalPreviewCard({ projectId, session }: { projectId: string; session: ExecutionSessionDto }): ReactElement {
  const { t } = useLocale();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [artifact, setArtifact] = useState<FullPreviewArtifactDto | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchMessage, setDispatchMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sessionOverride, setSessionOverride] = useState<ExecutionSessionDto | null>(null);

  const currentSession = sessionOverride ?? session;

  useEffect(() => {
    let cancelled = false;
    void fetchFullPreviewStatus(projectId, session.id).then((result) => {
      if (!cancelled) {
        if (result.ok) {
          setArtifact(result.data);
        }
        setHasLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, session.id, refreshKey]);

  const isFresh = artifact !== null && artifact.workingProjectSha256 === session.latestWorkingProjectSha256;
  const worker = findDispatchableWorker(dashboardStatus?.workers ?? null, "CREATE_PREVIEW");

  async function handleCreatePreview(): Promise<void> {
    setDispatchMessage(null);
    if (!worker) {
      setDispatchMessage({ text: t.projectWorkspace.overview.finalPreview.workerOffline, isError: true });
      return;
    }
    setIsDispatching(true);
    const result = await dispatchJob({ operation: "CREATE_PREVIEW", workerId: worker.workerId, projectId, executionSessionId: session.id });
    setIsDispatching(false);
    if (!result.ok) {
      setDispatchMessage({ text: result.message, isError: true });
      return;
    }
    setDispatchMessage({ text: t.jobDispatch.queuedDescription(result.data.jobId), isError: false });
  }

  async function handleApprove(): Promise<void> {
    setActionError(null);
    const result = await approveFinalPreview(projectId, session.id);
    if (!result.ok) {
      setActionError(result.message ?? null);
      return;
    }
    setSessionOverride(result.data);
  }

  async function handleRequestChanges(): Promise<void> {
    setActionError(null);
    const result = await requestFinalPreviewChanges(projectId, session.id);
    if (!result.ok) {
      setActionError(result.message ?? null);
      return;
    }
    setSessionOverride(result.data);
  }

  return (
    <Card className="overview-section final-preview-card">
      <CardHeader
        title={t.projectWorkspace.overview.finalPreview.title}
        action={currentSession.fullPreviewApproved ? <span className="status-badge status-badge--positive">{t.projectWorkspace.overview.finalPreview.approvedBadge}</span> : null}
      />
      {actionError ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={actionError} /> : null}

      {!hasLoaded ? null : !isFresh ? (
        <>
          <EmptyState title={t.projectWorkspace.overview.finalPreview.notReadyTitle} description={t.projectWorkspace.overview.finalPreview.notReadyDescription} />
          {dispatchMessage ? <p className={dispatchMessage.isError ? "final-preview-card__error" : "field__hint"}>{dispatchMessage.text}</p> : null}
          <div className="overview-actions">
            <Button variant="primary" disabled={isDispatching} onClick={() => void handleCreatePreview()}>
              {isDispatching ? t.jobDispatch.dispatching : t.projectWorkspace.overview.finalPreview.createAction}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
              {t.projectWorkspace.reload}
            </Button>
          </div>
        </>
      ) : (
        <>
          <VideoArtifactPlayer src={fullPreviewFileUrl(projectId, session.id)} ariaLabel={t.projectWorkspace.overview.finalPreview.title} />
          <div className="overview-actions">
            <Button variant="secondary" disabled={currentSession.fullPreviewApproved} onClick={() => void handleRequestChanges()}>
              {t.projectWorkspace.overview.finalPreview.requestChangesAction}
            </Button>
            <Button variant="primary" disabled={currentSession.fullPreviewApproved} onClick={() => void handleApprove()}>
              {currentSession.fullPreviewApproved ? t.projectWorkspace.overview.finalPreview.approvedBadge : t.projectWorkspace.overview.finalPreview.approveAction}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
