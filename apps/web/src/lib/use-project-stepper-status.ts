"use client";

import { useCallback, useEffect, useState } from "react";
import type { ExecutionSessionDto, JobHistoryEntryDto, RenderArtifactDto, WorkMap } from "@dyo/schemas";
import { fetchCurrentExecutionSession, fetchFullPreviewStatus, fetchJobHistory, fetchRenderArtifacts, fetchWorkMap } from "./projects-api-client";

const LIVE_JOB_STATUSES = new Set<JobHistoryEntryDto["status"]>(["QUEUED", "CLAIMED", "RUNNING"]);

/**
 * The live (queued, claimed or running) job of one operation for one project,
 * newest first, out of the caller's own job history - the same list the Jobs
 * page shows, so "is it still being made?" has one answer on every screen
 * and survives a page reload (2026-10-04: a reload during a complete preview
 * used to bring back a pressable "Create Complete Preview" button).
 *
 * A session id narrows it when the row carries one; a row with none is not
 * ruled out by it.
 */
export function findLiveJob(
  jobs: readonly JobHistoryEntryDto[],
  projectId: string,
  operation: JobHistoryEntryDto["operation"],
  executionSessionId?: string
): JobHistoryEntryDto | null {
  return (
    jobs.find(
      (job) =>
        job.projectId === projectId &&
        job.operation === operation &&
        LIVE_JOB_STATUSES.has(job.status) &&
        (executionSessionId === undefined || job.executionSessionId === null || job.executionSessionId === executionSessionId)
    ) ?? null
  );
}

export interface ProjectStepperStatus {
  workMap: WorkMap | null;
  session: ExecutionSessionDto | null;
  renderArtifacts: RenderArtifactDto[] | null;
  isLoading: boolean;
  /**
   * REAL 2026-09-25 INCIDENT follow-up ("never invent state"): a failed
   * fetch used to be flattened into the same `null` a genuinely absent
   * work map / session / render list produces, so a transient API failure
   * silently rendered as "this project has not started yet" - and the
   * guidance built on top would then confidently name the WRONG next
   * action. Loading and "could not load" are now distinguishable from
   * "really is absent"; callers that make claims about where a project is
   * must treat this as "we cannot tell" and say so.
   */
  hasError: boolean;
  /**
   * The current execution session specifically was read and answered - a
   * 200 carrying `null` counts, a failed request does not, and neither does
   * "still loading". Deliberately NARROWER than `hasError`, which is true if
   * ANY of the three fetches failed: a caller asking "is there live work
   * this edit would destroy?" (plan-edit-impact.ts) must not be told "we
   * cannot tell" because an unrelated work-map request failed.
   */
  sessionKnown: boolean;
  /**
   * Added 2026-10-04 so the "what to do next" banner can follow a build or a
   * complete preview while it runs and after it lands (it was seen saying
   * "press Start execution" under a finished first frame).
   *
   * All three are deliberately NOT part of `hasError`: they refine an answer
   * that is already correct without them ("make the full video" is still the
   * honest step if we cannot tell whether one is being made - pressing it
   * says so), so a failed job-history read must not blank the whole guidance
   * to "we cannot tell".
   */
  sceneBuildInFlight: boolean;
  fullPreviewInFlight: boolean;
  /** A complete preview exists for the session's CURRENT working copy. */
  fullPreviewReady: boolean;
  /** Reads everything again without going back to "loading" - the answers on screen stay until the new ones arrive. */
  refresh: () => void;
}

/**
 * The extra real state the global workflow stepper needs (client-handoff
 * phase, section B) that ProjectWorkspaceProvider does not already load
 * (which only fetches project + execution plan) - a separate, on-demand
 * fetch rather than widening that shared hook, so every other project
 * page's own load stays exactly as fast/minimal as it already is. A
 * failed fetch here never blocks the page or shows an error banner, but it
 * is NOT silently equivalent to "there is none yet" - see `hasError`.
 */
export function useProjectStepperStatus(projectId: string): ProjectStepperStatus {
  const [workMap, setWorkMap] = useState<WorkMap | null>(null);
  const [session, setSession] = useState<ExecutionSessionDto | null>(null);
  const [renderArtifacts, setRenderArtifacts] = useState<RenderArtifactDto[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [sessionKnown, setSessionKnown] = useState(false);
  const [sceneBuildInFlight, setSceneBuildInFlight] = useState(false);
  const [fullPreviewInFlight, setFullPreviewInFlight] = useState(false);
  const [fullPreviewReady, setFullPreviewReady] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      const [workMapResult, sessionResult, artifactsResult, jobsResult] = await Promise.all([
        fetchWorkMap(projectId),
        fetchCurrentExecutionSession(projectId),
        fetchRenderArtifacts(projectId),
        fetchJobHistory()
      ]);
      // Only worth asking once a complete preview can exist at all: the
      // server refuses to make one before the first frame is approved.
      const currentSession = sessionResult.ok ? sessionResult.data : null;
      const fullPreviewResult =
        currentSession && currentSession.firstPreviewApproved ? await fetchFullPreviewStatus(projectId, currentSession.id) : null;
      if (cancelled) {
        return;
      }
      const jobs = jobsResult.ok ? jobsResult.data.jobs : [];
      setSceneBuildInFlight(findLiveJob(jobs, projectId, "EXECUTE_FRAME") !== null);
      setFullPreviewInFlight(currentSession !== null && findLiveJob(jobs, projectId, "CREATE_PREVIEW", currentSession.id) !== null);
      setFullPreviewReady(
        currentSession !== null &&
          fullPreviewResult !== null &&
          fullPreviewResult.ok &&
          fullPreviewResult.data !== null &&
          fullPreviewResult.data.workingProjectSha256 === currentSession.latestWorkingProjectSha256
      );
      setWorkMap(workMapResult.ok ? workMapResult.data : null);
      setSession(sessionResult.ok ? sessionResult.data : null);
      setRenderArtifacts(artifactsResult.ok ? artifactsResult.data : null);
      // A 200 carrying `null`/`[]` is a real answer ("there is none yet").
      // Only a genuine transport/contract failure is unknown-ness.
      setHasError(!workMapResult.ok || !sessionResult.ok || !artifactsResult.ok);
      setSessionKnown(sessionResult.ok);
      setIsLoading(false);
    }

    // load() only calls setState after its own first `await` - same
    // accepted pattern as use-project-workspace.ts's own effect.
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  return { workMap, session, renderArtifacts, isLoading, hasError, sessionKnown, sceneBuildInFlight, fullPreviewInFlight, fullPreviewReady, refresh };
}
