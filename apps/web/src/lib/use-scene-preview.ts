"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SceneEvidencePreviewDto, WorkerDto } from "@dyo/schemas";
import { dispatchJob, fetchSceneEvidencePreviewStatus } from "./projects-api-client";
import { findDispatchableWorker } from "./find-dispatchable-worker";

/**
 * Simple, client-facing preview states only (client-facing UX redesign,
 * "M. VISUAL PREVIEWS ARE MANDATORY", point 8) - never exposes a Worker
 * job id/name/operation to Simple Mode. "checking" is the brief initial
 * load; "idle" means no preview has ever been captured and none is in
 * flight; "generating" covers both "job just dispatched" and "job
 * running" - the caller never needs to distinguish those two internally
 * distinct states.
 */
export type ScenePreviewState = "checking" | "idle" | "generating" | "ready" | "unavailable";

const POLL_INTERVAL_MS = 4_000;
/** ~2 minutes - a real INSPECT_SCENE_EVIDENCE + preview upload is a single read-only AE round trip, never expected to take longer than this in practice. */
const MAX_POLL_ATTEMPTS = 30;

export interface UseScenePreviewResult {
  preview: SceneEvidencePreviewDto | null;
  state: ScenePreviewState;
  /**
   * True once this scene's own content (mappings/text/assets - tracked via
   * ScenePlanEntry.updatedAt) has changed more recently than the preview
   * was captured. The caller must never present a stale preview as
   * current (point 9) - it stays visible (never hidden), just labeled.
   */
  isStale: boolean;
  requestPreview: () => void;
  errorMessage: string | null;
}

/**
 * Per-scene visual-preview state machine (client-facing UX redesign,
 * section E/F + "M. VISUAL PREVIEWS ARE MANDATORY"). Auto-dispatches the
 * SAME safe, server-resolved INSPECT_SCENE_EVIDENCE job
 * MappingAssistantPanel's "Improve AI accuracy" button already uses (see
 * resolve-inspect-scene-evidence-dispatch.ts - the browser sends only
 * scenePlanId), then polls the new scene-evidence-preview status endpoint
 * automatically until a genuinely NEW preview appears - never a manual
 * refresh, never a Jobs-page lookup.
 */
export function useScenePreview(
  projectId: string,
  scenePlanId: string,
  sceneUpdatedAt: string,
  workers: WorkerDto[] | null
): UseScenePreviewResult {
  const [preview, setPreview] = useState<SceneEvidencePreviewDto | null>(null);
  // "checking" is already the correct initial value for a freshly-mounted
  // card - each SceneCard is remounted (new React key) whenever it starts
  // representing a different scenePlanId (see SimpleScenesView), so there
  // is never a stale "ready"/"idle" from a previous scene to clear here.
  const [state, setState] = useState<ScenePreviewState>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const attemptsRef = useRef(0);
  const previewRef = useRef<SceneEvidencePreviewDto | null>(null);

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  useEffect(() => {
    let cancelled = false;
    void fetchSceneEvidencePreviewStatus(projectId, scenePlanId).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) {
        setPreview(result.data);
        setState("ready");
      } else {
        setPreview(null);
        setState("idle");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, scenePlanId]);

  useEffect(() => {
    if (!isPolling) {
      return;
    }
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        attemptsRef.current += 1;
        const result = await fetchSceneEvidencePreviewStatus(projectId, scenePlanId);
        if (cancelled) return;
        if (result.ok && result.data && result.data.capturedAt !== previewRef.current?.capturedAt) {
          setPreview(result.data);
          setState("ready");
          setIsPolling(false);
          attemptsRef.current = 0;
          return;
        }
        if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
          setIsPolling(false);
          attemptsRef.current = 0;
          setState(previewRef.current ? "ready" : "unavailable");
          setErrorMessage("Preview is taking longer than expected. Please try again.");
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isPolling, projectId, scenePlanId]);

  const requestPreview = useCallback((): void => {
    setErrorMessage(null);
    const worker = findDispatchableWorker(workers, "INSPECT_SCENE_EVIDENCE");
    if (!worker) {
      setErrorMessage("No computer is online to generate this preview right now.");
      return;
    }
    setState("generating");
    void dispatchJob({
      operation: "INSPECT_SCENE_EVIDENCE",
      workerId: worker.workerId,
      projectId,
      scenePlanId
    }).then((dispatched) => {
      if (!dispatched.ok) {
        setState(previewRef.current ? "ready" : "idle");
        setErrorMessage(dispatched.message);
        return;
      }
      attemptsRef.current = 0;
      setIsPolling(true);
    });
  }, [workers, projectId, scenePlanId]);

  const isStale =
    preview !== null && new Date(preview.capturedAt).getTime() < new Date(sceneUpdatedAt).getTime();

  return { preview, state, isStale, requestPreview, errorMessage };
}
