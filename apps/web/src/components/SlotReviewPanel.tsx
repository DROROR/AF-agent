"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { SceneEvidencePreviewDto, SlotAssessment, SlotClassification } from "@dyo/schemas";
import { dispatchJob, fetchJobStatus, fetchSceneEvidencePreviewStatus, sceneEvidencePreviewFileUrl } from "../lib/projects-api-client";
import { resolveProjectWorker } from "../lib/resolve-project-worker";
import { Button } from "./ui/Button";
import { useLocale } from "./LocaleProvider";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatus } from "../lib/use-dashboard-status";

/**
 * THE SLOT DECISION SURFACE (Stage 4).
 *
 * A reviewer is never asked to decide from a description. This panel shows
 * what the structure says, why, and - mandatorily - the real captured frame of
 * the moment the slot is genuinely on screen. The decision buttons stay
 * disabled until that frame exists and shows that moment, because the backend
 * refuses such a decision anyway (update-execution-plan.ts): the UI simply
 * never asks for something that cannot be recorded.
 *
 * The timestamp is never chosen here. The browser names the MAPPING and the
 * server resolves the moment from that slot's own structural facts, the same
 * way every other addressing fact is server-resolved.
 */

/** The reviewer's choice in this form session: accept the findings, or say what the slot actually is. */
export type SlotReviewChoice = { kind: "ACCEPT" } | { kind: "OVERRIDE"; classification: SlotClassification };

export interface SlotReviewPanelProps {
  scenePlanId: string;
  mappingId: string;
  assessment: SlotAssessment;
  /** True when the plan already carries a decision that no longer matches these findings. */
  decisionIsStale: boolean;
  choice: SlotReviewChoice | null;
  onChoose: (choice: SlotReviewChoice | null) => void;
  /** Reports the evidence frame the decision must be recorded against, or null when there is none to record. */
  onEvidenceFrame: (storageKey: string | null) => void;
}

const POLL_INTERVAL_MS = 4_000;
/** ~2 minutes: one read-only capture round trip, the same bound the scene preview queue uses. */
const MAX_POLL_ATTEMPTS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether this capture shows a moment the slot is genuinely on screen - the only thing that makes it evidence. */
function showsTheSlot(preview: SceneEvidencePreviewDto | null, window: { startSeconds: number; endSeconds: number } | null): boolean {
  if (!preview || preview.capturedAtSeconds === null || preview.capturedAtSeconds === undefined) {
    return false;
  }
  if (window === null) {
    return false;
  }
  return preview.capturedAtSeconds >= window.startSeconds && preview.capturedAtSeconds <= window.endSeconds;
}

export function SlotReviewPanel({ scenePlanId, mappingId, assessment, decisionIsStale, choice, onChoose, onEvidenceFrame }: SlotReviewPanelProps): ReactElement | null {
  const { t } = useLocale();
  const { project } = useProjectWorkspaceContext();
  const { data: dashboardStatus } = useDashboardStatus();
  const [preview, setPreview] = useState<SceneEvidencePreviewDto | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const projectId = project?.project.projectId ?? null;
  const blocker = assessment.blockers.find((candidate) => candidate.requiresEvidenceFrame) ?? null;
  const evidenceWindow = blocker?.evidenceFrameWindowSeconds ?? null;
  const evidenceAtSeconds = blocker?.evidenceFrameAtSeconds ?? null;
  const usable = showsTheSlot(preview, evidenceWindow);

  const refreshPreview = useCallback(async () => {
    if (projectId === null) {
      return;
    }
    const result = await fetchSceneEvidencePreviewStatus(projectId, scenePlanId);
    if (result.ok && !cancelledRef.current) {
      setPreview(result.data);
    }
  }, [projectId, scenePlanId]);

  useEffect(() => {
    cancelledRef.current = false;
    void refreshPreview();
    return () => {
      cancelledRef.current = true;
    };
  }, [refreshPreview]);

  // Whatever the panel currently holds IS what a decision would be recorded
  // against - reported upward so the drawer never sends a decision naming a
  // frame this reviewer was not actually shown. Keyed on the VALUE, not on the
  // callback's identity, so a parent re-render cannot make this fire forever.
  const reportedFrame = usable ? (preview?.storageKey ?? null) : null;
  const onEvidenceFrameRef = useRef(onEvidenceFrame);
  useEffect(() => {
    onEvidenceFrameRef.current = onEvidenceFrame;
  }, [onEvidenceFrame]);
  useEffect(() => {
    onEvidenceFrameRef.current(reportedFrame ?? null);
  }, [reportedFrame]);

  async function handleCapture(): Promise<void> {
    if (projectId === null) {
      return;
    }
    const worker = resolveProjectWorker(dashboardStatus?.workers ?? null, "INSPECT_SCENE_EVIDENCE", project?.project.sourceWorkerId ?? null);
    if (!worker) {
      setCaptureError(t.jobDispatch.workerOfflineDescription);
      return;
    }
    setIsCapturing(true);
    setCaptureError(null);
    // The server resolves WHICH moment from this mapping's own slot facts -
    // the browser only says which mapping needs to be seen.
    const dispatched = await dispatchJob({
      operation: "INSPECT_SCENE_EVIDENCE",
      workerId: worker.workerId,
      projectId,
      scenePlanId,
      slotEvidenceMappingId: mappingId
    });
    if (!dispatched.ok) {
      setIsCapturing(false);
      setCaptureError(dispatched.message);
      return;
    }
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      await sleep(POLL_INTERVAL_MS);
      if (cancelledRef.current) {
        return;
      }
      const status = await fetchJobStatus(dispatched.data.jobId);
      if (!status.ok) {
        continue;
      }
      if (status.data.status === "SUCCEEDED") {
        await refreshPreview();
        setIsCapturing(false);
        return;
      }
      if (status.data.status === "FAILED" || status.data.status === "CANCELLED") {
        setIsCapturing(false);
        setCaptureError(status.data.error?.message ?? t.projectWorkspace.editDrawer.slotEvidenceFrameMissing);
        return;
      }
    }
    setIsCapturing(false);
    setCaptureError(t.projectWorkspace.editDrawer.slotEvidenceFrameMissing);
  }

  if (assessment.blockers.length === 0) {
    return null;
  }

  const semantics = assessment.semantics;
  const classificationText =
    semantics === null
      ? t.projectWorkspace.editDrawer.slotClassificationUnknown
      : semantics.classification === "device_screen"
        ? t.projectWorkspace.editDrawer.slotClassificationDeviceScreen
        : semantics.classification === "flat_card"
          ? t.projectWorkspace.editDrawer.slotClassificationFlatCard
          : t.projectWorkspace.editDrawer.slotClassificationUnknown;

  // A slot with no provable visible moment can never be decided - the backend
  // refuses it, and this says so instead of offering buttons that would fail.
  const noProvableMoment = blocker !== null && evidenceAtSeconds === null;

  return (
    <div className="slot-findings" role="status" data-blocks="true">
      <p>
        <strong>{t.projectWorkspace.editDrawer.slotFindingsTitle}</strong>
      </p>
      <p>
        <span>{t.projectWorkspace.editDrawer.slotClassificationLabel}: </span>
        <span>{classificationText}</span>
        {semantics === null ? null : <span> ({t.projectWorkspace.editDrawer.slotConfidence(Math.round(semantics.confidence * 100))})</span>}
      </p>
      <ul>
        {assessment.blockers.map((entry) => (
          <li key={`${entry.kind}-${entry.mappingId}`}>{entry.reason}</li>
        ))}
      </ul>
      {semantics === null || semantics.positiveEvidence.length === 0 ? null : (
        <details>
          <summary>{t.projectWorkspace.editDrawer.slotEvidenceLabel}</summary>
          <ul>
            {[...semantics.positiveEvidence, ...semantics.negativeEvidence].map((entry) => (
              <li key={`${entry.code}-${entry.supports}`}>{entry.detail}</li>
            ))}
          </ul>
        </details>
      )}
      {decisionIsStale ? <p>{t.projectWorkspace.editDrawer.slotDecisionStale}</p> : null}

      {blocker === null ? null : (
        <div className="slot-evidence-frame">
          <p>
            <strong>{t.projectWorkspace.editDrawer.slotEvidenceFrameTitle}</strong>
          </p>
          {noProvableMoment ? (
            <p>{t.projectWorkspace.editDrawer.slotEvidenceFrameNoMoment}</p>
          ) : (
            <>
              <p>{t.projectWorkspace.editDrawer.slotEvidenceFrameHint(evidenceAtSeconds ?? 0)}</p>
              {usable && projectId !== null ? (
                <img src={sceneEvidencePreviewFileUrl(projectId, scenePlanId)} alt={t.projectWorkspace.editDrawer.slotEvidenceFrameAlt} />
              ) : (
                <p>
                  {preview === null
                    ? t.projectWorkspace.editDrawer.slotEvidenceFrameMissing
                    : t.projectWorkspace.editDrawer.slotEvidenceFrameStale(evidenceAtSeconds ?? 0)}
                </p>
              )}
              <Button variant="ghost" onClick={() => void handleCapture()} disabled={isCapturing}>
                {isCapturing ? t.projectWorkspace.editDrawer.slotEvidenceFrameCapturing : t.projectWorkspace.editDrawer.slotEvidenceFrameCapture}
              </Button>
              {captureError === null ? null : <p>{captureError}</p>}
            </>
          )}
        </div>
      )}

      {noProvableMoment ? null : (
        <>
          <p>{t.projectWorkspace.editDrawer.slotDecisionHint}</p>
          <div className="slot-decision-actions">
            <Button variant={choice?.kind === "ACCEPT" ? "primary" : "ghost"} disabled={!usable} onClick={() => onChoose({ kind: "ACCEPT" })}>
              {t.projectWorkspace.editDrawer.slotDecisionAccept}
            </Button>
            <Button
              variant={choice?.kind === "OVERRIDE" && choice.classification === "device_screen" ? "primary" : "ghost"}
              disabled={!usable}
              onClick={() => onChoose({ kind: "OVERRIDE", classification: "device_screen" })}
            >
              {t.projectWorkspace.editDrawer.slotDecisionOverrideDeviceScreen}
            </Button>
            <Button
              variant={choice?.kind === "OVERRIDE" && choice.classification === "flat_card" ? "primary" : "ghost"}
              disabled={!usable}
              onClick={() => onChoose({ kind: "OVERRIDE", classification: "flat_card" })}
            >
              {t.projectWorkspace.editDrawer.slotDecisionOverrideFlatCard}
            </Button>
            {choice === null ? null : (
              <Button variant="ghost" onClick={() => onChoose(null)}>
                {t.projectWorkspace.editDrawer.slotDecisionClear}
              </Button>
            )}
          </div>
          {choice === null ? null : (
            <p>
              {choice.kind === "ACCEPT"
                ? t.projectWorkspace.editDrawer.slotDecisionRecordedAccept
                : t.projectWorkspace.editDrawer.slotDecisionRecordedOverride}
            </p>
          )}
        </>
      )}
    </div>
  );
}
