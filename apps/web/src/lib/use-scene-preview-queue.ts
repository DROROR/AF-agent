"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SceneEvidencePreviewDto, WorkerDto } from "@dyo/schemas";
import { dispatchJob, fetchJobStatus, fetchSceneEvidencePreviewStatus } from "./projects-api-client";
import { resolveProjectWorker } from "./resolve-project-worker";
import type { RealScene } from "./real-scene-grouping";

/**
 * Simple, client-facing preview states only (client-facing UX redesign,
 * "M. VISUAL PREVIEWS ARE MANDATORY" point 8, and the "LIVE UX
 * ACCEPTANCE FAILED" section 6 follow-up) - never exposes a Worker job
 * id/name/operation. "checking" is the brief initial status read;
 * "queued" means this scene is waiting its turn behind another scene
 * currently generating; "generating" covers both "job just dispatched"
 * and "job running".
 */
export type ScenePreviewState = "checking" | "idle" | "queued" | "generating" | "ready" | "unavailable";

export interface ScenePreviewEntry {
  preview: SceneEvidencePreviewDto | null;
  state: ScenePreviewState;
  isStale: boolean;
  errorMessage: string | null;
  /**
   * The last generation attempt ENDED without a new preview: its job failed
   * or was cancelled, the dispatch was refused, or polling ran out. Nothing
   * is still in flight for this scene, so it must not hold approval hostage.
   * ("No computer online" is not terminal - that retries when a worker
   * appears.)
   */
  hasFailed: boolean;
}

const CHECKING_ENTRY: ScenePreviewEntry = { preview: null, state: "checking", isStale: false, errorMessage: null, hasFailed: false };

/**
 * Whether a scene's preview no longer blocks scene approval: a current
 * preview, or a generation attempt that has definitively ended in failure.
 *
 * REAL 2026-09-14 LOCK (Mixkit Smartphone Promo Final): every scene's preview
 * job failed within seconds, yet "Approve Scenes" stayed disabled forever on
 * "Updating previews" with every content decision already complete - only
 * `state === "ready"` ever counted, so a failed preview could never settle.
 * Previews are evidence for the human, not a server approval requirement
 * (approve-execution-plan.ts never checks them), and First Preview renders
 * the real frame anyway. Still checking/queued/generating keeps blocking.
 */
export function isScenePreviewSettled(entry: ScenePreviewEntry): boolean {
  if (entry.state === "checking" || entry.state === "queued" || entry.state === "generating") {
    return false;
  }
  return (entry.state === "ready" && !entry.isStale) || entry.hasFailed;
}

export interface UseScenePreviewQueueResult {
  getEntry: (scenePlanId: string) => ScenePreviewEntry;
  /** Manual retry, e.g. "Regenerate Preview" under Advanced/failure - jumps the queue rather than waiting behind every other scene. */
  regenerate: (scenePlanId: string) => void;
}

const POLL_INTERVAL_MS = 4_000;
/** ~2 minutes per scene - a real INSPECT_SCENE_EVIDENCE + preview upload is a single read-only AE round trip, never expected to take longer than this in practice. */
const MAX_POLL_ATTEMPTS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Central, page-level preview orchestrator (client-facing UX redesign,
 * "LIVE UX ACCEPTANCE FAILED" section 6): on load, identifies every real
 * scene with no preview yet (or a stale one) and automatically queues
 * them for generation - never requires 15 separate "Preview Scene"
 * clicks. Dispatches are strictly SEQUENTIAL (one scene at a time,
 * waiting for it to finish before starting the next) so this respects a
 * `maxConcurrency: 1` Worker exactly the way the server itself already
 * enforces it (a second concurrent dispatch would just be refused as
 * "busy worker" - this queue simply never attempts that in the first
 * place). A read (status check) is cheap and safe to run for every scene
 * up front; only a genuine generate/dispatch is ever queued.
 */
export function useScenePreviewQueue(
  projectId: string,
  realScenes: RealScene[],
  workers: WorkerDto[] | null,
  sourceWorkerId: string | null
): UseScenePreviewQueueResult {
  const [entries, setEntries] = useState<Map<string, ScenePreviewEntry>>(new Map());
  const entriesRef = useRef(entries);
  const workersRef = useRef(workers);
  const queueRef = useRef<string[]>([]);
  const isProcessingRef = useRef(false);
  const runIdRef = useRef(0);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    workersRef.current = workers;
  }, [workers]);

  const updateEntry = useCallback((scenePlanId: string, patch: Partial<ScenePreviewEntry>): void => {
    setEntries((prev) => {
      const next = new Map(prev);
      const current = next.get(scenePlanId) ?? CHECKING_ENTRY;
      next.set(scenePlanId, { ...current, ...patch });
      return next;
    });
  }, []);

  const dispatchAndPoll = useCallback(
    async (scenePlanId: string, runId: number): Promise<void> => {
      const worker = resolveProjectWorker(workersRef.current, "INSPECT_SCENE_EVIDENCE", sourceWorkerId);
      if (!worker) {
        updateEntry(scenePlanId, { state: "idle", errorMessage: "No computer is online to generate this preview right now." });
        return;
      }
      updateEntry(scenePlanId, { state: "generating", errorMessage: null, hasFailed: false });
      const dispatched = await dispatchJob({ operation: "INSPECT_SCENE_EVIDENCE", workerId: worker.workerId, projectId, scenePlanId });
      if (runId !== runIdRef.current) return;
      if (!dispatched.ok) {
        updateEntry(scenePlanId, {
          state: entriesRef.current.get(scenePlanId)?.preview ? "ready" : "idle",
          errorMessage: dispatched.message,
          hasFailed: true
        });
        return;
      }
      const previousCapturedAt = entriesRef.current.get(scenePlanId)?.preview?.capturedAt ?? null;
      const failWith = (errorMessage: string): void => {
        updateEntry(scenePlanId, {
          state: entriesRef.current.get(scenePlanId)?.preview ? "ready" : "unavailable",
          errorMessage,
          hasFailed: true
        });
      };
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        if (runId !== runIdRef.current) return;
        const result = await fetchSceneEvidencePreviewStatus(projectId, scenePlanId);
        if (runId !== runIdRef.current) return;
        if (result.ok && result.data && result.data.capturedAt !== previousCapturedAt) {
          updateEntry(scenePlanId, { preview: result.data, state: "ready", isStale: false, errorMessage: null, hasFailed: false });
          return;
        }
        // The preview job itself can end without ever producing a preview.
        // Waiting out the whole polling window for a job that already failed
        // is what left every scene on "Updating previews" (see
        // isScenePreviewSettled).
        const job = await fetchJobStatus(dispatched.data.jobId);
        if (runId !== runIdRef.current) return;
        if (job.ok && (job.data.status === "FAILED" || job.data.status === "CANCELLED")) {
          failWith("Preview could not be generated for this scene. Please try again.");
          return;
        }
      }
      failWith("Preview is taking longer than expected. Please try again.");
    },
    [projectId, sourceWorkerId, updateEntry]
  );

  const drainQueue = useCallback(
    async (runId: number): Promise<void> => {
      if (isProcessingRef.current) {
        return;
      }
      isProcessingRef.current = true;
      try {
        let next = queueRef.current.shift();
        while (next && runId === runIdRef.current) {
          await dispatchAndPoll(next, runId);
          if (runId !== runIdRef.current) {
            break;
          }
          next = queueRef.current.shift();
        }
      } finally {
        isProcessingRef.current = false;
      }
    },
    [dispatchAndPoll]
  );

  // Includes each scene's own updatedAt (not just its id) so an edit to an
  // EXISTING scene's mapping - which can newly make a previously-fresh
  // preview stale - re-triggers the effect below too, not only a change
  // to the overall set of real scenes.
  const sceneVersionsKey = useMemo(
    () => realScenes.map((realScene) => `${realScene.scenePlan.id}:${realScene.scenePlan.updatedAt}`).join(","),
    [realScenes]
  );

  useEffect(() => {
    const runId = ++runIdRef.current;
    queueRef.current = [];
    isProcessingRef.current = false;

    async function loadAll(): Promise<void> {
      const scenes = realScenes;
      const results = await Promise.all(
        scenes.map(async (realScene) => ({
          scenePlanId: realScene.scenePlan.id,
          updatedAt: realScene.scenePlan.updatedAt,
          result: await fetchSceneEvidencePreviewStatus(projectId, realScene.scenePlan.id)
        }))
      );
      if (runId !== runIdRef.current) return;

      // Computed synchronously from `results` BEFORE calling setEntries -
      // the functional updater passed to setState runs later (during
      // React's own reconciliation), not synchronously at the call site,
      // so `needsPreview` must never be built as a side effect inside it.
      const needsPreview: string[] = [];
      const statusUpdates = new Map<string, ScenePreviewEntry>();
      for (const { scenePlanId, updatedAt, result } of results) {
        if (result.ok && result.data) {
          const isStale = new Date(result.data.capturedAt).getTime() < new Date(updatedAt).getTime();
          statusUpdates.set(scenePlanId, { preview: result.data, state: "ready", isStale, errorMessage: null, hasFailed: false });
          if (isStale) {
            needsPreview.push(scenePlanId);
          }
        } else {
          statusUpdates.set(scenePlanId, { preview: null, state: "idle", isStale: false, errorMessage: null, hasFailed: false });
          needsPreview.push(scenePlanId);
        }
      }
      setEntries((prev) => {
        const next = new Map(prev);
        for (const [scenePlanId, entry] of statusUpdates) {
          next.set(scenePlanId, entry);
        }
        return next;
      });

      if (needsPreview.length > 0) {
        for (const scenePlanId of needsPreview) {
          updateEntry(scenePlanId, { state: "queued" });
        }
        queueRef.current.push(...needsPreview);
        // workers === null means the dashboard status poll simply hasn't
        // resolved yet, not "no worker is online" - draining now would
        // report a false "offline" for a worker that IS online. The
        // effect below retries as soon as workers becomes known.
        if (workersRef.current !== null) {
          void drainQueue(runId);
        }
      }
    }

    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- realScenes' own identity changes every render; sceneVersionsKey is the real, stable dependency signal (the set of scene ids + each one's updatedAt).
  }, [projectId, sceneVersionsKey, drainQueue, updateEntry]);

  // Retries the queue once workers becomes known (or changes) - covers
  // both "the dashboard status poll resolved after the initial load
  // above already ran" and "a worker came online after the last attempt
  // failed for lack of one".
  useEffect(() => {
    if (workers !== null && queueRef.current.length > 0 && !isProcessingRef.current) {
      void drainQueue(runIdRef.current);
    }
  }, [workers, drainQueue]);

  const getEntry = useCallback((scenePlanId: string): ScenePreviewEntry => entries.get(scenePlanId) ?? CHECKING_ENTRY, [entries]);

  const regenerate = useCallback(
    (scenePlanId: string): void => {
      queueRef.current = queueRef.current.filter((id) => id !== scenePlanId);
      queueRef.current.unshift(scenePlanId);
      updateEntry(scenePlanId, { state: "queued", errorMessage: null });
      void drainQueue(runIdRef.current);
    },
    [drainQueue, updateEntry]
  );

  return { getEntry, regenerate };
}
