"use client";

import { useEffect, useState, type ReactElement } from "react";
import type { ExecutionSessionDto, FullPreviewArtifactDto } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
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
 * "Preview" tab (final MVP nav, client-facing UX redesign section H) - the
 * two real human preview-approval gates in one place: the First Preview
 * (first designed frame, approved before every other scene is built) and
 * the Final Preview (the complete assembled video, approved before the
 * final render). Moved out of the old combined Overview tab so a client
 * has one obvious place to review and approve real AE-sourced previews,
 * without the plan/revision/technical facts Overview/"Project" still
 * shows. Every value here comes from the real execution-session/full-
 * preview-artifact API responses - never a placeholder.
 */
export function ProjectPreviewTab(): ReactElement | null {
  const { t } = useLocale();
  const { project, plan } = useProjectWorkspaceContext();
  const { data: dashboardStatus } = useDashboardStatusContext();
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

  // A FAILED session is terminal (multi-scene-accumulation phase, section
  // 11) - this tab treats it exactly like "no session yet" for its own
  // button logic (offer to start a fresh one), while still SHOWING the
  // failure so the client understands why (see the status line below).
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
    setDispatchSuccess(t.jobDispatch.startedHint);
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
        <CardHeader title={t.projectWorkspace.overview.executionSection} />
        {session ? (
          <dl className="overview-fact-list">
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
    setDispatchMessage({ text: t.jobDispatch.startedHint, isError: false });
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
