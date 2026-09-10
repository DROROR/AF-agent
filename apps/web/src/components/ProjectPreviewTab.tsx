"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { sceneEvidenceResponseSchema, type ExecutionSessionDto, type FullPreviewArtifactDto, type JobDto, type SceneEvidenceResponse } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { useWorkspaceMode } from "./WorkspaceModeProvider";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { VideoArtifactPlayer } from "./ui/VideoArtifactPlayer";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { LockedStepNotice } from "./LockedStepNotice";
import { useLocale } from "./LocaleProvider";
import {
  dispatchJob,
  createExecutionSession,
  fetchCurrentExecutionSession,
  fetchJobStatus,
  approveFirstPreview,
  rejectFirstPreview,
  executionSessionPreviewUrl,
  fetchFullPreviewStatus,
  fullPreviewFileUrl,
  approveFinalPreview,
  requestFinalPreviewChanges
} from "../lib/projects-api-client";
import { resolveProjectWorker } from "../lib/resolve-project-worker";
import { calculatePreviewTiming, derivePreviewTimingChainTargets, resolvePreviewTimingChains, type PreviewTimingCalculationResult } from "../lib/preview-timing";

// Same terminal-status set and poll cadence as NewProjectWizard's own
// dispatch-then-poll pattern (kept local rather than shared, same
// convention as that file - a one-line Set literal isn't worth a shared
// module).
const TERMINAL_JOB_STATUSES = new Set<JobDto["status"]>(["SUCCEEDED", "FAILED", "CANCELLED"]);
const JOB_POLL_INTERVAL_MS = 2_000;

/**
 * Preview Timing Analysis (live QA, 2026-09-09) - a self-contained
 * imperative poll loop (rather than the effect-driven inFlightJobId
 * pattern above) used only by handleAnalyzePreviewTiming below: that flow
 * dispatches two INSPECT_SCENE_EVIDENCE jobs strictly one after the other
 * (never both in flight at once, honoring the QA Worker's own
 * maxConcurrency=1), which reads far more directly as a single sequential
 * async function than as two more instances of the effect/state-based
 * pattern. `cancelledRef` stops polling (without throwing/updating state
 * on an unmounted component) if the component unmounts mid-poll.
 */
async function pollJobUntilTerminal(jobId: string, cancelledRef: { current: boolean }): Promise<{ ok: true; job: JobDto } | { ok: false; message: string }> {
  for (;;) {
    if (cancelledRef.current) {
      return { ok: false, message: "Cancelled" };
    }
    const result = await fetchJobStatus(jobId);
    if (result.ok && TERMINAL_JOB_STATUSES.has(result.data.status)) {
      if (result.data.status === "SUCCEEDED") {
        return { ok: true, job: result.data };
      }
      return { ok: false, message: result.data.error?.message ?? `Job ${result.data.status.toLowerCase()}` };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

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
  const { mode } = useWorkspaceMode();
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [session, setSession] = useState<ExecutionSessionDto | null>(null);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  // First Preview regeneration (live QA, 2026-09-08/09) - the operator's
  // own choice of capture time (section 13: "a controlled frame time",
  // never guessed) for the "Regenerate First Preview" action below.
  // Defaults to 1s rather than the same t=0 the operator just rejected.
  const [previewTimestampInput, setPreviewTimestampInput] = useState("1");
  // Tracks the EXECUTE_FRAME job dispatched by the button below, from
  // dispatch until it reaches a terminal status - see the polling effect
  // just under this one for why this exists (2026-09-08 live QA: a job
  // dispatch response only means "queued", never "the scene is done" - the
  // real AE mutation happens asynchronously on the Worker, 10-25+ seconds
  // later. Without this, isDispatching cleared as soon as the dispatch
  // HTTP call returned, so the button re-enabled and nextScenePlanId still
  // pointed at the same not-yet-completed scene - a click in that window
  // hit the server's own correct "already been edited" duplicate-dispatch
  // guard (resolve-execute-frame-dispatch.ts) while the dashboard still
  // showed stale 0/N progress, reading as a confusing failure for a scene
  // that had, in fact, already safely succeeded or was still safely
  // running - never a lost or double mutation, only a UI visibility gap).
  const [inFlightJobId, setInFlightJobId] = useState<string | null>(null);

  // Preview Timing Analysis (live QA, 2026-09-09) - see
  // handleAnalyzePreviewTiming below and pollJobUntilTerminal's own doc
  // comment for why this uses its own independent state rather than
  // isDispatching/inFlightJobId above (those are EXECUTE_FRAME-specific).
  const [timingPhase, setTimingPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [timingError, setTimingError] = useState<string | null>(null);
  const [timingResult, setTimingResult] = useState<Extract<PreviewTimingCalculationResult, { ok: true }> | null>(null);
  const timingCancelledRef = useRef(false);
  useEffect(() => {
    return () => {
      timingCancelledRef.current = true;
    };
  }, []);

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

  // Polls the real EXECUTE_FRAME job while non-terminal, same
  // dispatch-then-poll pattern as NewProjectWizard's INSPECT_TEMPLATE
  // polling - stops itself once SUCCEEDED/FAILED/CANCELLED, then refreshes
  // the session (picking up the real completedScenePlanIds/status) and
  // only THEN releases the button, so a second click can never race an
  // in-flight or just-completed dispatch for the same scene.
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!inFlightJobId) {
      return;
    }
    let cancelled = false;

    // Self-rescheduling, not a fixed-count/interval poll: each tick only
    // queues the next one once the previous fetch has actually returned,
    // so a slow response can never cause two overlapping requests in
    // flight for the same job.
    async function tick(): Promise<void> {
      const result = await fetchJobStatus(inFlightJobId as string);
      if (cancelled) {
        return;
      }
      if (result.ok && TERMINAL_JOB_STATUSES.has(result.data.status)) {
        setInFlightJobId(null);
        setIsDispatching(false);
        if (result.data.status === "SUCCEEDED") {
          setDispatchSuccess(t.jobDispatch.startedHint);
        } else {
          setDispatchError(result.data.error?.message ?? `Job ${result.data.status.toLowerCase()}`);
        }
        setSessionRefreshKey((k) => k + 1);
        return;
      }
      // Non-terminal status, or a transient status-fetch failure (not
      // itself a dispatch failure) - stay in-flight and try again, rather
      // than releasing the button onto stale local state.
      pollingRef.current = setTimeout(() => void tick(), JOB_POLL_INTERVAL_MS);
    }

    pollingRef.current = setTimeout(() => void tick(), JOB_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
      }
    };
  }, [inFlightJobId, t]);

  if (!project) {
    return null;
  }

  if (!plan) {
    return mode === "simple" ? (
      <LockedStepNotice
        projectId={project.project.projectId}
        title={t.projectWorkspace.lockedStep.preview.title}
        description={t.projectWorkspace.lockedStep.preview.description}
      />
    ) : (
      <Card>
        <EmptyState title={t.projectWorkspace.noPlanTitle} description={t.projectWorkspace.noPlanDescription} />
      </Card>
    );
  }

  const projectId = project.project.projectId;

  // A FAILED session is terminal (multi-scene-accumulation phase, section
  // 11) - this tab treats it exactly like "no session yet" for its own
  // "start a new edit" button logic, while still SHOWING the failure so
  // the client understands why (see the status line below).
  const activeSession = session && session.status !== "FAILED" ? session : null;

  // First Preview regeneration (live QA, 2026-09-08/09 incident): a
  // rejected preview marks the session FAILED - by design, for a
  // genuinely bad edit there is no "revise in place" (start a new
  // execution session instead). But real completed scene work + a real
  // working copy already exist here, and the actual incident was never
  // the EDIT being wrong - only the captured FRAME (t=0 landed on a solid
  // background color before any branding was visible). "Start execution"
  // must never be offered for THIS session (it would silently create a
  // brand new session and needlessly re-run the same MAP_FOOTAGE/SET_TEXT
  // work) - "Regenerate First Preview" (same working copy, a different
  // timestamp) is offered instead. See resolveRegeneratePreviewOnly
  // (apps/api) for the exact, narrower server-side preconditions this
  // mirrors - this is only the UI-side recognition of the same case.
  const canRegeneratePreview =
    session !== null &&
    (session.status === "AWAITING_PREVIEW_APPROVAL" || session.status === "FAILED") &&
    session.completedScenePlanIds.length > 0 &&
    session.latestWorkingProjectSha256 !== null &&
    session.latestPreviewScenePlanId !== null;

  const requiredScenePlanIds =
    plan.plan.status === "APPROVED"
      ? plan.plan.scenePlans.filter((scene) => scene.use && scene.approvalState === "APPROVED" && scene.unresolvedReasons.length === 0).map((s) => s.id)
      : [];
  const nextScenePlanId =
    requiredScenePlanIds.find((id) => !(activeSession?.completedScenePlanIds ?? []).includes(id)) ?? null;
  const allScenesComplete = activeSession !== null && requiredScenePlanIds.length > 0 && nextScenePlanId === null;

  // No session yet (or the last one FAILED and not regeneratable): the
  // browser picks a worker via the same non-authoritative heuristic used
  // elsewhere. Once a session exists (including a FAILED-but-
  // regeneratable one - its cumulative working copy still exists only on
  // ITS OWN pinned worker's local disk), every further dispatch is pinned
  // to ITS OWN assignedWorkerId - never re-chosen (section 8: worker
  // affinity).
  const sessionPinnedToWorker = activeSession ?? (canRegeneratePreview ? session : null);
  const candidateWorker = sessionPinnedToWorker
    ? (dashboardStatus?.workers ?? []).find((w) => w.workerId === sessionPinnedToWorker.assignedWorkerId) ?? null
    : resolveProjectWorker(dashboardStatus?.workers ?? null, "EXECUTE_FRAME", project.project.sourceWorkerId);
  const workerReady = sessionPinnedToWorker ? candidateWorker !== null && candidateWorker.status === "ONLINE" && candidateWorker.currentJobId === null : candidateWorker !== null;
  const canExecute = nextScenePlanId !== null && workerReady;
  // A session pins a specific worker (worker affinity, section 8) - if that
  // worker is offline this is a known, specific worker being unreachable,
  // not "no worker was ever found" - a more honest, actionable message than
  // the generic no-worker-available one.
  const isKnownWorkerOffline = sessionPinnedToWorker !== null && candidateWorker !== null && candidateWorker.status !== "ONLINE";

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
    if (!result.ok) {
      setIsDispatching(false);
      setDispatchError(result.message);
      return;
    }
    // Stay "dispatching" (button stays disabled) until the polling effect
    // above observes this job reach a terminal status - the dispatch HTTP
    // call only means "queued", never "the scene is done" (see that
    // effect's own doc comment for the real incident this fixes).
    setInFlightJobId(result.data.jobId);
  }

  async function handleRegeneratePreview(): Promise<void> {
    if (!session || !candidateWorker || session.latestPreviewScenePlanId === null) {
      return;
    }
    const parsedTimestamp = Number(previewTimestampInput);
    if (!Number.isFinite(parsedTimestamp) || parsedTimestamp < 0) {
      setDispatchError(t.jobDispatch.invalidPreviewTimestamp);
      return;
    }
    setIsDispatching(true);
    setDispatchError(null);
    setDispatchSuccess(null);

    // Never creates a new session/worker choice - regeneration only ever
    // targets THIS session's own existing, already-mutated working copy
    // on its own pinned worker (see resolveRegeneratePreviewOnly's own
    // doc comment for why this must never fall through to
    // createExecutionSession the way handleExecuteNextScene does).
    const result = await dispatchJob({
      operation: "EXECUTE_FRAME",
      workerId: session.assignedWorkerId,
      projectId,
      executionSessionId: session.id,
      scenePlanId: session.latestPreviewScenePlanId,
      regeneratePreviewOnly: true,
      previewTimestampSeconds: parsedTimestamp
    });
    if (!result.ok) {
      setIsDispatching(false);
      setDispatchError(result.message);
      return;
    }
    setInFlightJobId(result.data.jobId);
  }

  // Preview Timing Analysis (live QA, 2026-09-09 real incident, extended
  // to arbitrary nested depth 2026-09-10): derived only from this
  // session's own latestPreviewScenePlanId + the CURRENT plan's own real,
  // approved mappings for that scene - never a caller-supplied
  // compositionId/layerIndices (see resolveInspectSceneEvidenceDispatch's
  // own previewTimingChainIndex branch, which this drives). Null (button
  // hidden) when there is no real nested branding target to analyze at
  // all. `outerMostCompositionId` is the scene's own manifestCompositionId
  // (e.g. "!Render") - the true master timeline every reported range is
  // ultimately expressed against.
  const previewTimingScene =
    session && session.latestPreviewScenePlanId !== null ? plan.plan.scenePlans.find((s) => s.id === session.latestPreviewScenePlanId) ?? null : null;
  const previewTimingTargets = previewTimingScene ? derivePreviewTimingChainTargets(previewTimingScene.mappings, previewTimingScene.manifestCompositionId) : [];

  async function handleAnalyzePreviewTiming(): Promise<void> {
    if (!session || session.latestPreviewScenePlanId === null || !previewTimingScene || previewTimingTargets.length === 0) {
      return;
    }
    const worker = resolveProjectWorker(dashboardStatus?.workers ?? null, "INSPECT_SCENE_EVIDENCE", session.assignedWorkerId);
    if (!worker) {
      setTimingPhase("error");
      setTimingError(t.jobDispatch.workerOfflineDescription);
      return;
    }

    setTimingPhase("running");
    setTimingError(null);
    setTimingResult(null);
    timingCancelledRef.current = false;

    // Every target is dispatched strictly one after another - the next
    // INSPECT_SCENE_EVIDENCE job is never dispatched until the previous
    // one has reached a real terminal status (pollJobUntilTerminal below),
    // honoring the QA Worker's own maxConcurrency=1 regardless of how many
    // hops this scene's own real nested target chains actually have.
    const results: SceneEvidenceResponse[] = [];
    for (let chainIndex = 0; chainIndex < previewTimingTargets.length; chainIndex++) {
      const dispatched = await dispatchJob({
        operation: "INSPECT_SCENE_EVIDENCE",
        workerId: worker.workerId,
        projectId,
        scenePlanId: session.latestPreviewScenePlanId,
        previewTimingChainIndex: chainIndex
      });
      if (!dispatched.ok) {
        setTimingPhase("error");
        setTimingError(dispatched.message);
        return;
      }
      const polled = await pollJobUntilTerminal(dispatched.data.jobId, timingCancelledRef);
      if (timingCancelledRef.current) {
        return;
      }
      if (!polled.ok) {
        setTimingPhase("error");
        setTimingError(polled.message);
        return;
      }
      const parsed = sceneEvidenceResponseSchema.safeParse(polled.job.result);
      if (!parsed.success) {
        setTimingPhase("error");
        setTimingError(t.projectWorkspace.overview.previewTiming.evidenceUnavailable);
        return;
      }
      results.push(parsed.data);
    }

    const resolved = resolvePreviewTimingChains(previewTimingScene.mappings, previewTimingScene.manifestCompositionId, previewTimingTargets, results);
    if (!resolved.ok) {
      setTimingPhase("error");
      setTimingError(resolved.reason);
      return;
    }

    const calculation = calculatePreviewTiming(resolved.chains);
    if (!calculation.ok) {
      setTimingPhase("error");
      setTimingError(calculation.reason);
      return;
    }
    setTimingResult(calculation);
    setTimingPhase("done");
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
          // Cache-busted by the session's own real latestPreviewCapturedAt
          // (live QA, 2026-09-09) - without it this <img> keeps its OLD
          // src string across a regeneration and never re-fetches, even
          // though the real preview genuinely changed.
          <img
            key={session.latestPreviewCapturedAt ?? session.id}
            src={executionSessionPreviewUrl(projectId, session.id, session.latestPreviewCapturedAt)}
            alt={t.projectWorkspace.overview.previewImageAlt}
            style={{ maxWidth: "100%", borderRadius: "8px", marginBlock: "0.75rem" }}
          />
        ) : null}

        {canRegeneratePreview ? (
          <div className="overview-actions">
            <label>
              {t.jobDispatch.previewTimestampLabel}
              <input
                type="number"
                min="0"
                step="0.5"
                value={previewTimestampInput}
                disabled={isDispatching}
                onChange={(event) => setPreviewTimestampInput(event.target.value)}
              />
            </label>
            <Button variant="secondary" disabled={!workerReady || isDispatching} onClick={() => void handleRegeneratePreview()}>
              {isDispatching ? t.jobDispatch.dispatching : t.projectWorkspace.overview.regenerateFirstPreviewAction}
            </Button>
          </div>
        ) : null}

        {canRegeneratePreview && previewTimingTargets.length > 0 ? (
          <div className="overview-actions">
            <Button variant="secondary" disabled={!workerReady || timingPhase === "running"} onClick={() => void handleAnalyzePreviewTiming()}>
              {timingPhase === "running" ? t.jobDispatch.previewTimingAnalyzing : t.projectWorkspace.overview.previewTiming.action}
            </Button>
          </div>
        ) : null}
        {timingPhase === "running" ? <p role="status">{t.jobDispatch.previewTimingAnalyzing}</p> : null}
        {timingPhase === "error" && timingError ? <ErrorState title={t.projectWorkspace.overview.previewTiming.failureTitle} description={timingError} /> : null}
        {timingPhase === "done" && timingResult ? (
          <div className="overview-fact-list">
            <p role="status">{t.projectWorkspace.overview.previewTiming.recommendedLabel(timingResult.recommendedTimestampSeconds)}</p>
            {mode === "advanced" ? (
              <>
                {!timingResult.usedOverlap ? <p>{t.projectWorkspace.overview.previewTiming.noOverlapNote}</p> : null}
                <dl className="overview-fact-list">
                  {Object.entries(timingResult.rangesByLabel).map(([label, ranges]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{ranges.map((range) => t.projectWorkspace.overview.previewTiming.rangeLabel(range[0], range[1])).join(", ")}</dd>
                    </div>
                  ))}
                  {timingResult.overlapRanges.length > 0 ? (
                    <div>
                      <dt>{t.projectWorkspace.overview.previewTiming.overlapLabelHeading}</dt>
                      <dd>{timingResult.overlapRanges.map((range) => t.projectWorkspace.overview.previewTiming.rangeLabel(range[0], range[1])).join(", ")}</dd>
                    </div>
                  ) : null}
                </dl>
              </>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => setPreviewTimestampInput(String(timingResult.recommendedTimestampSeconds))}>
              {t.projectWorkspace.overview.previewTiming.applyAction}
            </Button>
          </div>
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
          ) : !allScenesComplete && !canRegeneratePreview ? (
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
  // Worker affinity fix (live QA Blocker 1): CREATE_PREVIEW is always
  // dispatched against an existing session, which already pins a specific
  // worker (assignedWorkerId, itself chosen against the project's own
  // source-worker affinity at session-creation time - see
  // create-execution-session.ts). There is no separate candidate-worker
  // choice to make here; using anything else (e.g. the generic
  // findDispatchableWorker heuristic) could pick an ONLINE worker that
  // dispatch-job.ts would then correctly refuse for not matching the
  // session.
  const worker = resolveProjectWorker(dashboardStatus?.workers ?? null, "CREATE_PREVIEW", currentSession.assignedWorkerId);

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
