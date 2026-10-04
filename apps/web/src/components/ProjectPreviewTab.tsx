"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  sceneEvidenceResponseSchema,
  type ExecutionSessionDto,
  type FullPreviewArtifactDto,
  type JobDto,
  type RenderOutputSuggestionResponse,
  type SceneEvidenceResponse
} from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { useWorkspaceMode } from "./WorkspaceModeProvider";
import { useProjectGuidanceRefresh } from "./ProjectGuidanceProvider";
import { VariantConfigCard } from "./ProjectRenderSettingsTab";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { BusyNotice, currentTimeMs } from "./ui/BusyNotice";
import { ProblemNotice } from "./ui/ProblemNotice";
import { Skeleton } from "./ui/Skeleton";
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
  fetchJobHistory,
  fetchRenderOutputSuggestion,
  approveFirstPreview,
  rejectFirstPreview,
  executionSessionPreviewUrl,
  fetchFullPreviewStatus,
  fullPreviewFileUrl,
  approveFinalPreview,
  requestFinalPreviewChanges
} from "../lib/projects-api-client";
import { resolveProjectWorker } from "../lib/resolve-project-worker";
import { findLiveJob } from "../lib/use-project-stepper-status";
import {
  calculatePreviewTiming,
  derivePreviewTimingChainTargets,
  distinctChainEntryCompositionIds,
  resolveManifestPathHops,
  resolvePreviewTimingChains,
  type ChainHopSlot,
  type PreviewTimingCalculationResult
} from "../lib/preview-timing";

// Same terminal-status set and poll cadence as NewProjectWizard's own
// dispatch-then-poll pattern (kept local rather than shared, same
// convention as that file - a one-line Set literal isn't worth a shared
// module).
const TERMINAL_JOB_STATUSES = new Set<JobDto["status"]>(["SUCCEEDED", "FAILED", "CANCELLED"]);
const JOB_POLL_INTERVAL_MS = 2_000;
/** A complete preview takes minutes, not seconds - no need to ask as often as for a single scene. */
const FULL_PREVIEW_POLL_INTERVAL_MS = 4_000;
/** How long a complete preview someone ELSE started (no job of ours to watch) is waited on before trusting an idle editing computer over the server's "already being made". */
const UNWATCHED_PREVIEW_MIN_WAIT_MS = 30_000;

/**
 * What went wrong, and at which point (2026-10-04). Every failure on this
 * tab used to be one string under one title, "Could not dispatch this job" -
 * which was untrue for the commonest case, a job that was dispatched fine and
 * then failed inside After Effects. The kind is what lets Simple mode say
 * something true; Advanced still shows `message` exactly as before.
 *
 *  - "job":      it ran on the editing computer and failed there (raw worker text).
 *  - "dispatch": the server refused to start it, with a reason written for a person.
 *  - "busy":     refused only because the editing computer is doing something else.
 *  - "action":   an approve/reject call that did not go through.
 */
type TabFailure = { kind: "job" | "dispatch" | "busy" | "action"; message: string };

/** The server's wording when a second complete preview is asked for while one is running - see dispatch-job.ts's duplicate-dispatch check. Matched only AFTER the typed WORKER_BUSY code, to tell "this very thing is already being made" from "busy with something else". */
const ALREADY_MAKING_FULL_PREVIEW = /already has a live CREATE_PREVIEW job/;

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
 * Preview Timing Analysis (live QA, 2026-09-09/10) - dispatches ONE real
 * INSPECT_SCENE_EVIDENCE job and awaits its real terminal result, parsed
 * against the shared response schema. Used for BOTH the known human-chain
 * targets (`previewTimingChainIndex`) and the adaptive composition-graph
 * discovery steps (`previewTimingDiscoverCompositionId`) below - the two
 * dispatch shapes differ, the poll-then-parse mechanics don't.
 */
async function dispatchAndPollSceneEvidence(
  dispatchRequest: Parameters<typeof dispatchJob>[0],
  cancelledRef: { current: boolean },
  evidenceUnavailableMessage: string
): Promise<{ ok: true; response: SceneEvidenceResponse } | { ok: false; message: string }> {
  const dispatched = await dispatchJob(dispatchRequest);
  if (!dispatched.ok) {
    return { ok: false, message: dispatched.message };
  }
  const polled = await pollJobUntilTerminal(dispatched.data.jobId, cancelledRef);
  if (cancelledRef.current) {
    return { ok: false, message: "Cancelled" };
  }
  if (!polled.ok) {
    return { ok: false, message: polled.message };
  }
  const parsed = sceneEvidenceResponseSchema.safeParse(polled.job.result);
  if (!parsed.success) {
    return { ok: false, message: evidenceUnavailableMessage };
  }
  return { ok: true, response: parsed.data };
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
  const isSimple = mode === "simple";
  const refreshGuidance = useProjectGuidanceRefresh();
  const [failure, setFailure] = useState<TabFailure | null>(null);
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);
  // When the build now running began - what the "being built… 0:42" clock
  // counts from. Null whenever no build is running (an approve/reject call
  // also sets isDispatching, and is not a build).
  const [buildStartedAt, setBuildStartedAt] = useState<string | number | null>(null);
  // Simple mode, 2026-10-04: "yes, this frame looks right" is the approval
  // AND the request for the full video. The approval is the click; this only
  // remembers that the full-video card should start by itself once it is on
  // screen, instead of making the person find a second button.
  const [makeFullVideoAfterApproval, setMakeFullVideoAfterApproval] = useState(false);
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

  // 2026-10-04: a page reload during a build brought back a button that
  // looked pressable. The job is still in the caller's own job history (the
  // list the Jobs page shows), so pick it up from there and carry on
  // watching it exactly as if this page had dispatched it.
  useEffect(() => {
    if (!projectIdForEffect) {
      return;
    }
    let cancelled = false;
    void fetchJobHistory().then((result) => {
      if (cancelled || !result.ok) {
        return;
      }
      const live = findLiveJob(result.data.jobs, projectIdForEffect, "EXECUTE_FRAME");
      if (live) {
        setInFlightJobId((current) => current ?? live.jobId);
        setBuildStartedAt((current) => current ?? live.createdAt);
        setIsDispatching(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectIdForEffect]);

  // 2026-10-04: the blue "what to do next" banner read the session once on
  // page load and went on saying "Create the first preview - press Start
  // execution" under a finished first frame. Whenever the facts it is
  // derived from change here, it is told to read them again.
  const sessionStatus = session?.status ?? null;
  const sessionCompletedCount = session?.completedScenePlanIds.length ?? 0;
  const sessionFirstPreviewApproved = session?.firstPreviewApproved ?? false;
  useEffect(() => {
    refreshGuidance();
  }, [refreshGuidance, sessionStatus, sessionCompletedCount, sessionFirstPreviewApproved, inFlightJobId]);

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
        setBuildStartedAt(null);
        if (result.data.status === "SUCCEEDED") {
          setDispatchSuccess(t.jobDispatch.startedHint);
        } else {
          setFailure({ kind: "job", message: result.data.error?.message ?? `Job ${result.data.status.toLowerCase()}` });
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

  // REAL 2026-09-25 INCIDENT: every button on this tab could be greyed out
  // for a worker reason (offline / never connected / already busy) that was
  // only ever stated in a card-level EmptyState which is not rendered in
  // every branch - so "Regenerate First Preview" and "Analyze Preview
  // Timing" in particular could sit disabled with nothing on screen
  // explaining them at all. One derived reason, reused by each control that
  // genuinely depends on the worker, so they can never disagree.
  const workerDisabledReason = workerReady ? undefined : isKnownWorkerOffline ? t.projectWorkspace.disabledReason.workerOffline : t.projectWorkspace.disabledReason.noWorker;
  const executeDisabledReason = isDispatching
    ? t.projectWorkspace.disabledReason.working
    : requiredScenePlanIds.length === 0
      ? t.projectWorkspace.disabledReason.noExecutableScene
      : nextScenePlanId === null
        ? t.projectWorkspace.disabledReason.allScenesExecuted
        : workerDisabledReason;

  async function handleExecuteNextScene(): Promise<void> {
    if (!nextScenePlanId || !candidateWorker) {
      return;
    }
    setIsDispatching(true);
    setFailure(null);
    setDispatchSuccess(null);
    setBuildStartedAt(currentTimeMs());

    let targetSession = activeSession;
    if (!targetSession) {
      const created = await createExecutionSession(projectId, candidateWorker.workerId);
      if (!created.ok) {
        setIsDispatching(false);
        setBuildStartedAt(null);
        setFailure({ kind: "dispatch", message: created.message });
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
      setBuildStartedAt(null);
      setFailure({ kind: result.code === "WORKER_BUSY" ? "busy" : "dispatch", message: result.message });
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
      setFailure({ kind: "dispatch", message: t.jobDispatch.invalidPreviewTimestamp });
      return;
    }
    setIsDispatching(true);
    setFailure(null);
    setDispatchSuccess(null);
    setBuildStartedAt(currentTimeMs());

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
      setBuildStartedAt(null);
      setFailure({ kind: result.code === "WORKER_BUSY" ? "busy" : "dispatch", message: result.message });
      return;
    }
    setInFlightJobId(result.data.jobId);
  }

  // Preview Timing Analysis (live QA, 2026-09-09 real incident, extended
  // to arbitrary nested depth + real composition-graph discovery
  // 2026-09-10): derived only from this session's own
  // latestPreviewScenePlanId + the CURRENT plan's own real, approved
  // mappings for that scene - never a caller-supplied compositionId/
  // layerIndices (see resolveInspectSceneEvidenceDispatch's own
  // previewTimingChainIndex/previewTimingDiscoverCompositionId branches,
  // which this drives). The button is hidden when there is no real
  // nested branding target to analyze at all. `outerMostCompositionId` is
  // the scene's own manifestCompositionId (e.g. "!Render") - the true
  // master timeline every reported range is ultimately expressed against.
  const previewTimingScene =
    session && session.latestPreviewScenePlanId !== null ? plan.plan.scenePlans.find((s) => s.id === session.latestPreviewScenePlanId) ?? null : null;
  const previewTimingHumanTargets = previewTimingScene ? derivePreviewTimingChainTargets(previewTimingScene.mappings) : [];

  async function handleAnalyzePreviewTiming(): Promise<void> {
    if (!project || !session || session.latestPreviewScenePlanId === null || !previewTimingScene || previewTimingHumanTargets.length === 0) {
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

    const evidenceUnavailableMessage = t.projectWorkspace.overview.previewTiming.evidenceUnavailable;
    const resultsByCompositionId = new Map<string, SceneEvidenceResponse>();
    const discoveredOuterPaths = new Map<string, ChainHopSlot[]>();

    // Phase 1 (live QA, 2026-09-10 targeted host-layer lookup extension):
    // for every mapping's own chain-entry composition that isn't already
    // the scene's own outermost composition, resolve the REAL path
    // reaching it - PRIMARILY from the project's own manifest
    // (`parentCompositionIds`, already AE-confirmed by the original
    // INSPECT_TEMPLATE inspection, zero live dispatches for the sequence
    // itself), with exactly one targeted host-layer-lookup live dispatch
    // per already-known hop to discover EVERY real host layer + its own
    // timing evidence (never a broad exploratory scan of sibling
    // compositions or of the parent's own full layer list - see
    // resolveManifestPathHops's own doc comment). Entirely sequential -
    // both across distinct entry compositions and within each hop's own
    // lookup - so at most one INSPECT_SCENE_EVIDENCE job is ever in
    // flight, honoring the QA Worker's own maxConcurrency=1.
    const manifestCompositions = project.manifest.compositions.map((c) => ({ compositionId: c.compositionId, parentCompositionIds: c.parentCompositionIds }));
    const entryCompositionIds = distinctChainEntryCompositionIds(previewTimingScene.mappings, previewTimingScene.manifestCompositionId);
    for (const entryCompositionId of entryCompositionIds) {
      const discovered = await resolveManifestPathHops(
        manifestCompositions,
        previewTimingScene.manifestCompositionId,
        entryCompositionId,
        (parentCompositionId, childCompositionId) =>
          dispatchAndPollSceneEvidence(
            {
              operation: "INSPECT_SCENE_EVIDENCE",
              workerId: worker.workerId,
              projectId,
              scenePlanId: session.latestPreviewScenePlanId as string,
              previewTimingDiscoverCompositionId: parentCompositionId,
              previewTimingFindHostLayersChildCompositionId: childCompositionId
            },
            timingCancelledRef,
            evidenceUnavailableMessage
          )
      );
      if (timingCancelledRef.current) {
        return;
      }
      if (!discovered.ok) {
        setTimingPhase("error");
        setTimingError(discovered.reason);
        return;
      }
      discoveredOuterPaths.set(entryCompositionId, discovered.hopSlots);
    }

    // Phase 2: every target is dispatched strictly one after another - the
    // next INSPECT_SCENE_EVIDENCE job is never dispatched until the
    // previous one has reached a real terminal status, same
    // maxConcurrency=1 guarantee as phase 1 above.
    for (let chainIndex = 0; chainIndex < previewTimingHumanTargets.length; chainIndex++) {
      const target = previewTimingHumanTargets[chainIndex]!;
      const result = await dispatchAndPollSceneEvidence(
        {
          operation: "INSPECT_SCENE_EVIDENCE",
          workerId: worker.workerId,
          projectId,
          scenePlanId: session.latestPreviewScenePlanId,
          previewTimingChainIndex: chainIndex
        },
        timingCancelledRef,
        evidenceUnavailableMessage
      );
      if (timingCancelledRef.current) {
        return;
      }
      if (!result.ok) {
        setTimingPhase("error");
        setTimingError(result.message);
        return;
      }
      resultsByCompositionId.set(target.compositionId, result.response);
    }

    const resolved = resolvePreviewTimingChains(previewTimingScene.mappings, previewTimingScene.manifestCompositionId, discoveredOuterPaths, resultsByCompositionId);
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
    setFailure(null);
    setDispatchSuccess(null);
    const result = await approveFirstPreview(projectId, activeSession.id);
    setIsDispatching(false);
    if (!result.ok) {
      setFailure({ kind: "action", message: result.message });
      return;
    }
    setSession(result.data);
    // Only ever set by this handler, i.e. by the person's own click on the
    // approval - nothing else in this file can ask for the full video.
    if (isSimple) {
      setMakeFullVideoAfterApproval(true);
    }
  }

  async function handleRejectPreview(): Promise<void> {
    if (!activeSession) {
      return;
    }
    setIsDispatching(true);
    setFailure(null);
    setDispatchSuccess(null);
    const result = await rejectFirstPreview(projectId, activeSession.id);
    setIsDispatching(false);
    if (!result.ok) {
      setFailure({ kind: "action", message: result.message });
      return;
    }
    setSession(result.data);
  }

  const sp = t.projectWorkspace.simplePreview;
  const isBuilding = isDispatching && buildStartedAt !== null;
  const awaitingFrameDecision = activeSession?.status === "AWAITING_PREVIEW_APPROVAL";

  // The expert tooling around the first frame: capture at another time,
  // and work out which time shows the branding. One definition, drawn at
  // full weight in Advanced (as it always was) and inside a closed
  // disclosure in Simple (2026-10-04: "Preview at (seconds)" was the first
  // thing a client met under their first frame).
  const previewTools = (
    <>
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
          <Button
            variant="secondary"
            disabled={!workerReady || isDispatching}
            disabledReason={isDispatching ? t.projectWorkspace.disabledReason.working : workerDisabledReason}
            onClick={() => void handleRegeneratePreview()}
          >
            {isDispatching ? t.jobDispatch.dispatching : t.projectWorkspace.overview.regenerateFirstPreviewAction}
          </Button>
        </div>
      ) : null}

      {canRegeneratePreview && previewTimingHumanTargets.length > 0 ? (
        <div className="overview-actions">
          <Button
            variant="secondary"
            disabled={!workerReady || timingPhase === "running"}
            disabledReason={timingPhase === "running" ? t.projectWorkspace.disabledReason.working : workerDisabledReason}
            onClick={() => void handleAnalyzePreviewTiming()}
          >
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
    </>
  );

  const workerEmptyState =
    requiredScenePlanIds.length === 0 ? (
      <EmptyState title={t.projectWorkspace.overview.noApprovedSceneTitle} description={t.projectWorkspace.overview.noApprovedSceneDescription} />
    ) : !workerReady && !allScenesComplete && !isBuilding ? (
      isKnownWorkerOffline ? (
        <EmptyState title={t.jobDispatch.workerOfflineTitle} description={t.jobDispatch.workerOfflineDescription} />
      ) : (
        <EmptyState title={t.jobDispatch.noWorkerTitle} description={t.jobDispatch.noWorkerDescription} />
      )
    ) : null;

  if (isSimple) {
    // SIMPLE MODE (2026-10-04). The owner walked this tab as a client would
    // and could not tell where to click: an engineering progress count, a
    // thumbnail, "Preview at (seconds)", a status line and up to five
    // buttons at equal weight. What is left is one step with one question -
    // does this frame look right? - and, after a yes, one more step below.
    // Everything removed here is still in Advanced, unchanged.
    const frameApproved = activeSession?.firstPreviewApproved ?? false;
    const wasNotApproved = session !== null && session.status === "FAILED" && canRegeneratePreview;
    const showExecuteButton = !awaitingFrameDecision && !allScenesComplete && !canRegeneratePreview && !isBuilding;
    return (
      <div className="overview-grid">
        <Card className="overview-section first-frame-card">
          <CardHeader title={sp.firstFrameTitle} />
          {workerEmptyState}
          {failure ? (
            failure.kind === "job" ? (
              // The job WAS dispatched; it failed inside After Effects. The
              // raw worker sentence ("operation 2 (…) failed: …") is kept
              // word for word, behind the closed disclosure.
              <ProblemNotice title={sp.buildFailedTitle} description={sp.buildFailedDescription} technicalDetails={failure.message} />
            ) : failure.kind === "busy" ? (
              <ProblemNotice title={sp.startFailedTitle} description={sp.workerBusy} technicalDetails={failure.message} />
            ) : failure.kind === "action" ? (
              <ProblemNotice title={sp.actionFailedTitle} description={sp.actionFailedDescription} technicalDetails={failure.message} />
            ) : (
              // A refusal to start carries a reason the server wrote for a
              // person to act on (a missing brand line, a picture that does
              // not fit its slot) - hiding that behind a disclosure would
              // hide the instruction itself.
              <ProblemNotice title={sp.startFailedTitle} description={failure.message} />
            )
          ) : null}

          {isBuilding ? <BusyNotice title={sp.buildingTitle} description={sp.buildingDescription} startedAt={buildStartedAt} /> : null}

          {awaitingFrameDecision && session?.hasPreview ? (
            <>
              <p className="first-frame__question">
                <strong>{sp.frameQuestion}</strong>
              </p>
              <p className="field__hint">{sp.frameQuestionHint}</p>
            </>
          ) : wasNotApproved ? (
            <EmptyState
              title={sp.frameRejectedTitle}
              description={sp.frameRejectedDescription}
              action={
                <Link href={`/projects/${projectId}/scenes`} className="btn btn--secondary btn--sm">
                  {sp.backToScenesAction}
                </Link>
              }
            />
          ) : frameApproved ? (
            <p role="status">{sp.frameApprovedNote}</p>
          ) : !session?.hasPreview && !isBuilding && requiredScenePlanIds.length > 0 ? (
            <p>{sp.startIntro}</p>
          ) : null}

          {session?.hasPreview ? (
            // Same authenticated byte stream and the same cache-busting key
            // as Advanced below - only the size differs. It was a thumbnail,
            // and it is the one thing on this page the person is asked about.
            <img
              key={session.latestPreviewCapturedAt ?? session.id}
              src={executionSessionPreviewUrl(projectId, session.id, session.latestPreviewCapturedAt)}
              alt={t.projectWorkspace.overview.previewImageAlt}
              className="first-frame__image"
            />
          ) : null}

          {frameApproved && !allScenesComplete && !isBuilding ? <p>{sp.continueIntro}</p> : null}

          <div className="overview-actions">
            {awaitingFrameDecision ? (
              <>
                <Button variant="primary" disabled={isDispatching} disabledReason={t.projectWorkspace.disabledReason.working} onClick={() => void handleApprovePreview()}>
                  {allScenesComplete ? sp.frameYesAndMakeAction : sp.frameYesAction}
                </Button>
                <Button variant="secondary" disabled={isDispatching} disabledReason={t.projectWorkspace.disabledReason.working} onClick={() => void handleRejectPreview()}>
                  {sp.frameNoAction}
                </Button>
              </>
            ) : showExecuteButton ? (
              <Button variant="primary" disabled={!canExecute || isDispatching} disabledReason={executeDisabledReason} onClick={() => void handleExecuteNextScene()}>
                {failure ? sp.tryAgainAction : frameApproved ? sp.continueAction : sp.startAction}
              </Button>
            ) : null}
          </div>

          {canRegeneratePreview ? (
            // Opened for you only when the frame was not approved - that is
            // the one moment "try another point in time" is the likely next
            // thing to want.
            <details className="advanced-details" open={wasNotApproved}>
              <summary>{sp.differentMomentToggle}</summary>
              <p className="field__hint">{sp.differentMomentHint}</p>
              {previewTools}
            </details>
          ) : null}
        </Card>

        {/*
          Not offered at all until the first frame is approved (2026-10-04):
          with one scene, "every scene is built" was already true while the
          frame still awaited its answer, so a live "Create Complete Preview"
          sat under it and pressing it produced the server's "first-frame
          preview has not been approved yet" in red. The server gate is
          unchanged; this only stops offering what it will refuse.
        */}
        {allScenesComplete && activeSession && activeSession.firstPreviewApproved ? (
          <FinalPreviewCard
            projectId={projectId}
            session={activeSession}
            startRequested={makeFullVideoAfterApproval}
            onStartRequestHandled={() => setMakeFullVideoAfterApproval(false)}
          />
        ) : null}
      </div>
    );
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

        {workerEmptyState}
        {failure ? <ErrorState title={t.jobDispatch.failedTitle} description={failure.message} /> : null}
        {isBuilding ? <BusyNotice compact title={sp.buildingTitle} startedAt={buildStartedAt} /> : null}
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

        {previewTools}

        <div className="overview-actions">
          {awaitingFrameDecision ? (
            <>
              <Button variant="primary" disabled={isDispatching} disabledReason={t.projectWorkspace.disabledReason.working} onClick={() => void handleApprovePreview()}>
                {isDispatching ? t.jobDispatch.dispatching : t.projectWorkspace.overview.approvePreviewAction}
              </Button>
              <Button variant="secondary" disabled={isDispatching} disabledReason={t.projectWorkspace.disabledReason.working} onClick={() => void handleRejectPreview()}>
                {t.projectWorkspace.overview.rejectPreviewAction}
              </Button>
            </>
          ) : !allScenesComplete && !canRegeneratePreview ? (
            <Button variant="primary" disabled={!canExecute || isDispatching} disabledReason={executeDisabledReason} onClick={() => void handleExecuteNextScene()}>
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

type FullVideoFailure = { kind: "job" | "dispatch" | "busy" | "offline"; message: string };

/**
 * A complete preview on its way. `jobId` is null in exactly one case: the
 * server said one is already being made and it is not in this person's own
 * job history (someone else started it), so there is no job to watch - the
 * finished video itself is watched for instead.
 */
interface FullVideoInProgress {
  phase: "starting" | "running";
  jobId: string | null;
  startedAt: string | number;
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
 *
 * 2026-10-04, all seen live in one sitting:
 *
 *  - NO FEEDBACK. Pressing "Create Complete Preview" changed nothing on the
 *    page for minutes, so it was pressed again, and the answer was a red
 *    "Worker <uuid> already has a live CREATE_PREVIEW job in progress". The
 *    button is now replaced by a running notice with a clock from the moment
 *    it is pressed until the video is there; the page watches the job and
 *    shows the video by itself; a reload finds the job again in the job
 *    history; and that refusal is read as what it means - already being made.
 *  - A POINTER TO ANOTHER TAB. "Landscape output is not configured ...
 *    configure it in Render Settings" sent a client to an Advanced-only tab
 *    to type After Effects template names. In Simple mode the setup is taken
 *    from a suggestion the server could establish without guessing, or - when
 *    it could not - the same form is shown right here.
 */
function FinalPreviewCard({
  projectId,
  session,
  startRequested = false,
  onStartRequestHandled
}: {
  projectId: string;
  session: ExecutionSessionDto;
  /** Simple mode: the person just said yes to the first frame, which is also the request for the full video. */
  startRequested?: boolean;
  onStartRequestHandled?: () => void;
}): ReactElement {
  const { t } = useLocale();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const { project, plan, setRenderOutput } = useProjectWorkspaceContext();
  const { mode } = useWorkspaceMode();
  const isSimple = mode === "simple";
  const refreshGuidance = useProjectGuidanceRefresh();
  const router = useRouter();
  const [artifact, setArtifact] = useState<FullPreviewArtifactDto | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [inProgress, setInProgress] = useState<FullVideoInProgress | null>(null);
  // Whether the job history has been read once - until it has, "is one
  // already being made?" is unanswered, and nothing is started automatically.
  const [historyChecked, setHistoryChecked] = useState(false);
  const [failure, setFailure] = useState<FullVideoFailure | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sessionOverride, setSessionOverride] = useState<ExecutionSessionDto | null>(null);
  // undefined: not known yet. null: the server has nothing safe to offer.
  const [suggestion, setSuggestion] = useState<RenderOutputSuggestionResponse["suggestion"] | undefined>(undefined);

  const currentSession = sessionOverride ?? session;
  const sp = t.projectWorkspace.simplePreview;

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

  // A reload while the video is being made must show the same "being made"
  // state, not a pressable button: the job is in the caller's own job
  // history, the same list the Jobs page shows.
  useEffect(() => {
    let cancelled = false;
    void fetchJobHistory().then((result) => {
      if (cancelled) {
        return;
      }
      const live = result.ok ? findLiveJob(result.data.jobs, projectId, "CREATE_PREVIEW", session.id) : null;
      if (live) {
        setInProgress((current) => current ?? { phase: "running", jobId: live.jobId, startedAt: live.createdAt });
      }
      setHistoryChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, session.id]);

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

  // The complete preview is made from the LANDSCAPE output's own
  // composition and settings (resolve-create-full-preview-dispatch.ts). Same
  // freshness rule as the Export tab: set up against an older template
  // counts as not set up.
  const landscapeConfig = plan?.plan.renderOutputs.LANDSCAPE ?? null;
  const sourceSha = project?.manifest.sourceProject.sha256 ?? null;
  const landscapeConfigured = landscapeConfig !== null && landscapeConfig.sourceProjectSha256 === sourceSha;
  const needsSetup = isSimple && !landscapeConfigured;

  useEffect(() => {
    if (!needsSetup) {
      return;
    }
    let cancelled = false;
    void fetchRenderOutputSuggestion(projectId, "LANDSCAPE").then((result) => {
      if (!cancelled) {
        // A failed read is treated as "nothing to offer": the form is then
        // shown, which always works - never a guess, never a dead end.
        setSuggestion(result.ok ? result.data : null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [needsSetup, projectId]);

  // The pinned editing computer, as the dashboard's own 10s poll last saw
  // it - read through a ref so the watcher below does not restart on every
  // poll.
  const pinnedWorker = (dashboardStatus?.workers ?? []).find((w) => w.workerId === currentSession.assignedWorkerId) ?? null;
  const pinnedWorkerIdle = pinnedWorker !== null && pinnedWorker.status === "ONLINE" && pinnedWorker.currentJobId === null;
  const pinnedWorkerIdleRef = useRef(pinnedWorkerIdle);
  useEffect(() => {
    pinnedWorkerIdleRef.current = pinnedWorkerIdle;
  }, [pinnedWorkerIdle]);

  // Watches the complete preview until it is there (or has failed), so the
  // video appears by itself. Self-rescheduling like the scene-build poll
  // above: the next read is only queued once the previous one has returned.
  const watchedPhase = inProgress?.phase ?? null;
  const watchedJobId = inProgress?.jobId ?? null;
  const sessionId = session.id;
  const currentWorkingSha = session.latestWorkingProjectSha256;
  useEffect(() => {
    if (watchedPhase !== "running") {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const watchStartedAt = Date.now();
    let baselineCapturedAt: string | null | undefined;

    async function showResult(): Promise<void> {
      const status = await fetchFullPreviewStatus(projectId, sessionId);
      if (cancelled) {
        return;
      }
      if (status.ok) {
        setArtifact(status.data);
      }
      setInProgress(null);
    }

    async function tick(): Promise<void> {
      if (watchedJobId !== null) {
        const result = await fetchJobStatus(watchedJobId);
        if (cancelled) {
          return;
        }
        if (result.ok && TERMINAL_JOB_STATUSES.has(result.data.status)) {
          if (result.data.status === "SUCCEEDED") {
            await showResult();
          } else {
            setFailure({ kind: "job", message: result.data.error?.message ?? `Job ${result.data.status.toLowerCase()}` });
            setInProgress(null);
          }
          return;
        }
      } else {
        // No job of ours to watch: look for the video itself, and for the
        // job turning up in our history after all.
        const [status, history] = await Promise.all([fetchFullPreviewStatus(projectId, sessionId), fetchJobHistory()]);
        if (cancelled) {
          return;
        }
        const live = history.ok ? findLiveJob(history.data.jobs, projectId, "CREATE_PREVIEW", sessionId) : null;
        if (live) {
          setInProgress({ phase: "running", jobId: live.jobId, startedAt: live.createdAt });
          return;
        }
        if (status.ok) {
          const capturedAt = status.data?.capturedAt ?? null;
          if (baselineCapturedAt === undefined) {
            baselineCapturedAt = capturedAt;
          } else if (status.data !== null && capturedAt !== baselineCapturedAt && status.data.workingProjectSha256 === currentWorkingSha) {
            setArtifact(status.data);
            setInProgress(null);
            return;
          }
        }
        // Never an endless wait on something that is no longer happening:
        // once the editing computer reports itself free, show whatever is
        // really there and hand the button back.
        if (Date.now() - watchStartedAt > UNWATCHED_PREVIEW_MIN_WAIT_MS && pinnedWorkerIdleRef.current) {
          await showResult();
          return;
        }
      }
      // Still running, or a transient read failure - keep waiting rather
      // than drop back to a button onto stale state.
      timer = setTimeout(() => void tick(), FULL_PREVIEW_POLL_INTERVAL_MS);
    }

    timer = setTimeout(() => void tick(), FULL_PREVIEW_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [watchedPhase, watchedJobId, projectId, sessionId, currentWorkingSha]);

  // The banner above the tabs follows this card: "make it" -> "being made"
  // -> "watch and approve" -> "go to Export".
  const artifactCapturedAt = artifact?.capturedAt ?? null;
  const fullPreviewApproved = currentSession.fullPreviewApproved;
  useEffect(() => {
    refreshGuidance();
  }, [refreshGuidance, watchedPhase, artifactCapturedAt, fullPreviewApproved]);

  async function handleCreatePreview(): Promise<void> {
    if (inProgress) {
      return;
    }
    setFailure(null);
    if (!worker) {
      setFailure({ kind: "offline", message: t.projectWorkspace.overview.finalPreview.workerOffline });
      return;
    }
    const pressedAt = currentTimeMs();
    // Visible from the press itself, not from the server's answer: the gap
    // between the two is where the second press used to happen.
    setInProgress({ phase: "starting", jobId: null, startedAt: pressedAt });

    if (needsSetup) {
      if (!suggestion) {
        // Not reachable from the buttons (none is drawn without a
        // suggestion); here so a missing setup can never be dispatched past.
        setInProgress(null);
        return;
      }
      // The same call the form's Save makes, with values the server itself
      // established (this template's only master composition; names another
      // project on the same editing computer is already set up with) - the
      // line above the button says which, before anything is pressed.
      const saved = await setRenderOutput("LANDSCAPE", {
        manifestCompositionId: suggestion.manifestCompositionId,
        renderSettingsTemplateName: suggestion.renderSettingsTemplateName,
        outputModuleTemplateName: suggestion.outputModuleTemplateName
      });
      if (!saved.ok) {
        setInProgress(null);
        setFailure({ kind: "dispatch", message: saved.message ?? "" });
        return;
      }
    }

    const result = await dispatchJob({ operation: "CREATE_PREVIEW", workerId: worker.workerId, projectId, executionSessionId: session.id });
    if (result.ok) {
      setInProgress({ phase: "running", jobId: result.data.jobId, startedAt: result.data.createdAt });
      return;
    }
    if (result.code === "WORKER_BUSY") {
      // "Already has a live CREATE_PREVIEW job" is not an error to a person:
      // it means the video is already being made. Find that job and watch
      // it; if it is not ours to see, watch for the video instead.
      const history = await fetchJobHistory();
      const live = history.ok ? findLiveJob(history.data.jobs, projectId, "CREATE_PREVIEW", session.id) : null;
      if (live) {
        setInProgress({ phase: "running", jobId: live.jobId, startedAt: live.createdAt });
        return;
      }
      if (ALREADY_MAKING_FULL_PREVIEW.test(result.message)) {
        setInProgress({ phase: "running", jobId: null, startedAt: pressedAt });
        return;
      }
      setInProgress(null);
      setFailure({ kind: "busy", message: result.message });
      return;
    }
    setInProgress(null);
    setFailure({ kind: "dispatch", message: result.message });
  }

  // "Yes, make my full video" on the first frame: started here, once, as
  // soon as everything it depends on is known - and never when a video is
  // already there or already being made. With no suggestion to set the
  // output up from, nothing is started: the form is on screen instead.
  const createPreviewRef = useRef(handleCreatePreview);
  useEffect(() => {
    createPreviewRef.current = handleCreatePreview;
  });
  const suggestionKnown = !needsSetup || suggestion !== undefined;
  const canStartByItself = !isFresh && inProgress === null && (!needsSetup || (suggestion !== undefined && suggestion !== null));
  useEffect(() => {
    if (!startRequested || !hasLoaded || !historyChecked || !suggestionKnown) {
      return;
    }
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) {
        return;
      }
      onStartRequestHandled?.();
      if (canStartByItself) {
        void createPreviewRef.current();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [startRequested, hasLoaded, historyChecked, suggestionKnown, canStartByItself, onStartRequestHandled]);

  async function handleApprove(): Promise<void> {
    setActionError(null);
    const result = await approveFinalPreview(projectId, session.id);
    if (!result.ok) {
      setActionError(result.message ?? null);
      return;
    }
    setSessionOverride(result.data);
    // 2026-10-04: after this approval the Export tab kept its lock icon and
    // the banner kept saying "approve the preview" until a hard reload,
    // although the server already had the session ready to render. Both are
    // told to re-read now, and in Simple mode the person is taken to Export -
    // the next step - the same way Approve Scenes takes them to Preview.
    // Only on success, and only ever from this click.
    refreshGuidance();
    if (isSimple) {
      router.push(`/projects/${projectId}/export`);
    }
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

  const failureNotice = !failure ? null : isSimple ? (
    failure.kind === "job" ? (
      <ProblemNotice title={sp.fullVideoFailedTitle} description={sp.fullVideoFailedDescription} technicalDetails={failure.message} />
    ) : failure.kind === "busy" ? (
      <ProblemNotice title={sp.fullVideoNotStartedTitle} description={sp.workerBusy} technicalDetails={failure.message} />
    ) : (
      // "offline" and "dispatch": the message is already a sentence written
      // for the person (turn the computer on; what the plan is missing).
      <ProblemNotice title={sp.fullVideoNotStartedTitle} description={failure.message} />
    )
  ) : (
    <p className="final-preview-card__error">{failure.message}</p>
  );

  // The setup form, shown only when nothing could be established without
  // guessing. The SAME component the Export and Render Settings tabs use -
  // never a second form writing the same row - and it disappears by itself
  // once a current choice is saved.
  const showSetupForm = needsSetup && suggestion === null && hasLoaded && !isFresh && inProgress === null && project !== null;

  return (
    <>
      <Card className="overview-section final-preview-card">
        <CardHeader
          title={isSimple ? sp.fullVideoTitle : t.projectWorkspace.overview.finalPreview.title}
          action={currentSession.fullPreviewApproved ? <span className="status-badge status-badge--positive">{t.projectWorkspace.overview.finalPreview.approvedBadge}</span> : null}
        />
        {actionError ? (
          isSimple ? (
            <ProblemNotice title={sp.actionFailedTitle} description={sp.actionFailedDescription} technicalDetails={actionError} />
          ) : (
            <ErrorState title={t.projectWorkspace.saveFailedTitle} description={actionError} />
          )
        ) : null}

        {!hasLoaded ? null : inProgress ? (
          // Replaces every button on this card for as long as it runs, so
          // there is nothing to press a second time.
          <BusyNotice title={sp.makingTitle} description={sp.makingDescription} startedAt={inProgress.startedAt} />
        ) : !isFresh ? (
          isSimple ? (
            <>
              {failureNotice}
              {needsSetup && suggestion === undefined ? (
                <Skeleton height="1.5rem" />
              ) : needsSetup && suggestion === null ? (
                <EmptyState title={sp.setupNeededTitle} description={sp.setupNeededDescription} />
              ) : (
                <>
                  <p>{sp.fullVideoIntro}</p>
                  {needsSetup && suggestion ? <p className="field__hint">{sp.suggestionLine(suggestion.compositionName, suggestion.basedOnProjectName)}</p> : null}
                  <div className="overview-actions">
                    <Button variant="primary" onClick={() => void handleCreatePreview()}>
                      {failure ? sp.tryAgainAction : sp.makeFullVideoAction}
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <EmptyState title={t.projectWorkspace.overview.finalPreview.notReadyTitle} description={t.projectWorkspace.overview.finalPreview.notReadyDescription} />
              {failureNotice}
              <div className="overview-actions">
                <Button variant="primary" onClick={() => void handleCreatePreview()}>
                  {t.projectWorkspace.overview.finalPreview.createAction}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
                  {t.projectWorkspace.reload}
                </Button>
              </div>
            </>
          )
        ) : (
          <>
            {/* Keyed on the capture time so a regenerated video is really loaded again, not the one the player already holds. */}
            <VideoArtifactPlayer key={artifact?.capturedAt ?? "preview"} src={fullPreviewFileUrl(projectId, session.id)} ariaLabel={t.projectWorkspace.overview.finalPreview.title} />
            {isSimple ? <p role="status">{currentSession.fullPreviewApproved ? sp.approvedNote : sp.watchQuestion}</p> : null}
            {failureNotice}
            <div className="overview-actions">
              {/*
                Real 2026-09-10/11 incident (session a7fee3d9): isFresh only
                compares workingProjectSha256 - it has no way to know the
                WORKER's own rendering behavior changed (e.g. the
                full-duration-render fix) independently of the working copy's
                content, so an existing artifact that still matches the
                working copy's hash can legitimately be stale in a way this
                check can't see. Regenerate reuses the EXACT SAME
                handleCreatePreview/CREATE_PREVIEW dispatch as the "not
                fresh" branch above - no new dispatch path, no change to
                auth, plan, mappings, scene use flags, approval state,
                session identity, or the AE project. Always available here,
                independent of fullPreviewApproved, so a stale-but-approved
                preview can still be regenerated without first touching its
                approval (Request Changes/Approve stay the separate, only
                actions that change fullPreviewApproved).
              */}
              <Button variant="secondary" onClick={() => void handleCreatePreview()}>
                {t.projectWorkspace.overview.finalPreview.regenerateAction}
              </Button>
              <Button
                variant="secondary"
                disabled={currentSession.fullPreviewApproved}
                disabledReason={t.projectWorkspace.disabledReason.finalPreviewAlreadyApproved}
                onClick={() => void handleRequestChanges()}
              >
                {t.projectWorkspace.overview.finalPreview.requestChangesAction}
              </Button>
              <Button
                variant="primary"
                disabled={currentSession.fullPreviewApproved}
                disabledReason={t.projectWorkspace.disabledReason.finalPreviewAlreadyApproved}
                onClick={() => void handleApprove()}
              >
                {currentSession.fullPreviewApproved ? t.projectWorkspace.overview.finalPreview.approvedBadge : t.projectWorkspace.overview.finalPreview.approveAction}
              </Button>
            </div>
          </>
        )}
      </Card>
      {showSetupForm && project ? (
        <VariantConfigCard
          projectId={projectId}
          variant="LANDSCAPE"
          compositions={project.manifest.compositions}
          currentConfig={landscapeConfig}
          currentSourceSha={project.manifest.sourceProject.sha256}
          session={currentSession}
          renderReady={false}
          showRenderAction={false}
        />
      ) : null}
    </>
  );
}
