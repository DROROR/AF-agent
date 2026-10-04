"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  assessMappingSlot,
  slotEvidenceDigest,
  type ExecutionPlanEditOperation,
  type SceneEvidencePreviewDto,
  type SlotBlocker
} from "@dyo/schemas";
import { dispatchJob, fetchJobStatus, fetchSceneEvidencePreviewStatus, sceneEvidencePreviewFileUrl } from "../lib/projects-api-client";
import { resolveProjectWorker } from "../lib/resolve-project-worker";
import { useProjectAssets } from "../lib/use-project-assets";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { useLocale } from "./LocaleProvider";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";

/**
 * EVERY PICTURE THAT NEEDS A DECISION, ON ONE SCREEN (2026-10-04).
 *
 * REAL SESSION: a mockup template with ten phone screens and a logo. Each
 * picture needed its own decision in its own scene's drawer - open, capture
 * the evidence frame, choose, save - eleven times, and Approve Scenes gave no
 * sign of it until it was refused.
 *
 * Nothing about the rule changes here. A decision is still the reviewer's
 * own, still bound to the frame they were shown, and the server still
 * refuses one without that slot's own current frame
 * (update-execution-plan.ts). This only removes the walking: it asks After
 * Effects for each slot's frame in turn, shows them all together, and
 * records the one decision "these are right as assigned" for every picture
 * whose frame is on screen. A slot the reviewer disagrees with is still
 * decided in its scene's drawer, where it can be overridden.
 */

const POLL_INTERVAL_MS = 4_000;
const MAX_POLL_ATTEMPTS = 45;
/** The worker runs one job at a time and the page's own scene previews use it too - a refused dispatch is retried, not reported. */
const DISPATCH_RETRY_ATTEMPTS = 24;
const DISPATCH_RETRY_INTERVAL_MS = 5_000;

interface PendingSlot {
  scenePlanId: string;
  mappingId: string;
  label: string;
  reasons: string[];
  window: { startSeconds: number; endSeconds: number } | null;
  canBeShown: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A frame counts here only if it was captured FOR this slot.
 *
 * REAL 2026-10-04: the scene's own representative preview (taken for the
 * scene card, at a moment chosen for the scene) happened to fall inside one
 * slot's window, and was shown as that slot's evidence - a picture of a
 * transition, with no button pressed. A frame captured for the slot is taken
 * at the middle of the slot's own window; that is the one a reviewer is
 * asked to look at here.
 */
function showsTheSlot(preview: SceneEvidencePreviewDto | null | undefined, slot: Pick<PendingSlot, "mappingId" | "window">): boolean {
  const window = slot.window;
  if (!preview || preview.capturedAtSeconds === null || preview.capturedAtSeconds === undefined || window === null || preview.storageKey === undefined) {
    return false;
  }
  if (preview.slotMappingId !== slot.mappingId) {
    return false;
  }
  return preview.capturedAtSeconds >= window.startSeconds && preview.capturedAtSeconds <= window.endSeconds;
}

export function SlotBulkReview(): ReactElement | null {
  const { t } = useLocale();
  const { project, plan, applyEdit, isStale } = useProjectWorkspaceContext();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const projectId = project?.project.projectId ?? "";
  const { assets } = useProjectAssets(projectId);
  const [previews, setPreviews] = useState<Record<string, SceneEvidencePreviewDto | null>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const cancelledRef = useRef(false);

  const pending = useMemo<PendingSlot[]>(() => {
    if (!project || !plan || assets === null) {
      return [];
    }
    const placeholders = new Map(project.manifest.scenes.flatMap((scene) => scene.placeholders.map((p) => [p.placeholderId, p] as const)));
    const slots: PendingSlot[] = [];
    for (const scene of plan.plan.scenePlans) {
      if (!scene.use) {
        continue;
      }
      for (const mapping of scene.mappings) {
        const asset = mapping.selectedAssetId === null ? null : (assets.find((a) => a.id === mapping.selectedAssetId) ?? null);
        const assessment = assessMappingSlot({
          scene,
          mapping,
          manifest: project.manifest,
          asset:
            asset === null
              ? null
              : {
                  id: asset.id,
                  widthPx: asset.width,
                  heightPx: asset.height,
                  hasAlphaChannel: asset.hasAlphaChannel ?? null,
                  hasTransparentPixels: asset.hasTransparentPixels ?? null,
                  transparentPixelRatio: asset.transparentPixelRatio ?? null,
                  visibleCoverageRatio: asset.visibleCoverageRatio ?? null,
                  visibleContentBounds: asset.visibleContentBounds ?? null
                }
        });
        if (assessment.blockers.length === 0) {
          continue;
        }
        const review = mapping.slotReview ?? null;
        if (review !== null && review.evidenceDigest === slotEvidenceDigest(assessment)) {
          continue;
        }
        const framed: SlotBlocker | undefined = assessment.blockers.find((blocker) => blocker.requiresEvidenceFrame);
        const placeholder = mapping.manifestPlaceholderId === null ? undefined : placeholders.get(mapping.manifestPlaceholderId);
        const where = placeholder?.layerPath.at(-1) ?? scene.compositionName;
        slots.push({
          scenePlanId: scene.id,
          mappingId: mapping.id,
          label: `${where} › ${mapping.placeholderName ?? ""}`.trim(),
          reasons: [...new Set(assessment.blockers.map((blocker) => blocker.reason))],
          window: framed?.evidenceFrameWindowSeconds ?? null,
          canBeShown: framed !== undefined && framed.evidenceFrameAtSeconds !== null
        });
      }
    }
    return slots;
  }, [project, plan, assets]);

  const pendingKey = pending.map((slot) => slot.mappingId).join(",");

  const refresh = useCallback(
    async (slot: PendingSlot): Promise<SceneEvidencePreviewDto | null> => {
      const result = await fetchSceneEvidencePreviewStatus(projectId, slot.scenePlanId, slot.mappingId);
      const preview = result.ok ? result.data : null;
      if (!cancelledRef.current) {
        setPreviews((current) => ({ ...current, [slot.mappingId]: preview }));
      }
      return preview;
    },
    [projectId]
  );

  useEffect(() => {
    cancelledRef.current = false;
    for (const slot of pending) {
      void refresh(slot);
    }
    return () => {
      cancelledRef.current = true;
    };
    // Keyed on WHICH slots are pending, not on the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, refresh]);

  if (pending.length === 0) {
    return null;
  }

  const showable = pending.filter((slot) => slot.canBeShown);
  const ready = showable.filter((slot) => showsTheSlot(previews[slot.mappingId], slot));
  const missing = showable.filter((slot) => !showsTheSlot(previews[slot.mappingId], slot));
  const reasons = [...new Set(pending.flatMap((slot) => slot.reasons))];

  async function captureOne(slot: PendingSlot): Promise<string | null> {
    const worker = resolveProjectWorker(dashboardStatus?.workers ?? null, "INSPECT_SCENE_EVIDENCE", project?.project.sourceWorkerId ?? null);
    if (!worker) {
      return t.jobDispatch.workerOfflineDescription;
    }
    let jobId: string | null = null;
    let lastMessage: string | null = null;
    for (let attempt = 0; attempt < DISPATCH_RETRY_ATTEMPTS && jobId === null; attempt += 1) {
      // The server resolves WHICH moment from this mapping's own slot facts.
      const dispatched = await dispatchJob({
        operation: "INSPECT_SCENE_EVIDENCE",
        workerId: worker.workerId,
        projectId,
        scenePlanId: slot.scenePlanId,
        slotEvidenceMappingId: slot.mappingId
      });
      if (dispatched.ok) {
        jobId = dispatched.data.jobId;
      } else {
        lastMessage = dispatched.message;
        await sleep(DISPATCH_RETRY_INTERVAL_MS);
        if (cancelledRef.current) {
          return null;
        }
      }
    }
    if (jobId === null) {
      return lastMessage ?? t.projectWorkspace.editDrawer.slotEvidenceFrameMissing;
    }
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      await sleep(POLL_INTERVAL_MS);
      if (cancelledRef.current) {
        return null;
      }
      const status = await fetchJobStatus(jobId);
      if (!status.ok) {
        continue;
      }
      if (status.data.status === "SUCCEEDED") {
        const preview = await refresh(slot);
        return showsTheSlot(preview, slot) ? null : t.projectWorkspace.editDrawer.slotEvidenceFrameMissing;
      }
      if (status.data.status === "FAILED" || status.data.status === "CANCELLED") {
        return status.data.error?.message ?? t.projectWorkspace.editDrawer.slotEvidenceFrameMissing;
      }
    }
    return t.projectWorkspace.editDrawer.slotEvidenceFrameMissing;
  }

  async function handleShowAll(): Promise<void> {
    setError(null);
    const queue = [...missing];
    setProgress({ done: 0, total: queue.length });
    for (const [index, slot] of queue.entries()) {
      const problem = await captureOne(slot);
      if (cancelledRef.current) {
        return;
      }
      if (problem !== null) {
        setError(`${slot.label}: ${problem}`);
        break;
      }
      setProgress({ done: index + 1, total: queue.length });
    }
    setProgress(null);
  }

  async function handleConfirm(): Promise<void> {
    setIsSaving(true);
    setError(null);
    const operations: ExecutionPlanEditOperation[] = ready.map((slot) => ({
      type: "SET_SLOT_REVIEW",
      scenePlanId: slot.scenePlanId,
      mappingId: slot.mappingId,
      decision: "ACCEPT",
      evidenceFrameStorageKey: previews[slot.mappingId]!.storageKey!
    }));
    const result = await applyEdit(operations);
    setIsSaving(false);
    if (!result.ok) {
      setError(result.message ?? null);
    }
  }

  const busy = progress !== null || isSaving;

  return (
    <Card className="slot-bulk-review">
      <h3>{t.simpleScenes.slotBulk.title(pending.length)}</h3>
      <p>{t.simpleScenes.slotBulk.description}</p>
      {/* The findings in the system's own words stay one press away: a client reads the sentence above, a reviewer who wants the detail opens this. */}
      <details className="advanced-details">
        <summary>{t.simpleScenes.slotBulk.whyToggle}</summary>
        <ul className="slot-bulk-review__reasons">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </details>

      {ready.length > 0 ? (
        <div className="slot-bulk-review__grid">
          {ready.map((slot) => (
            <figure key={slot.mappingId}>
              <img
                src={`${sceneEvidencePreviewFileUrl(projectId, slot.scenePlanId, slot.mappingId)}&v=${encodeURIComponent(previews[slot.mappingId]?.storageKey ?? "")}`}
                alt={slot.label}
              />
              <figcaption>{slot.label}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {error ? <p className="scene-card__error">{error}</p> : null}

      <div className="overview-actions">
        {missing.length > 0 ? (
          <Button variant="secondary" disabled={busy || isStale} onClick={() => void handleShowAll()}>
            {progress !== null ? t.simpleScenes.slotBulk.showing(progress.done, progress.total) : t.simpleScenes.slotBulk.showAllAction(missing.length)}
          </Button>
        ) : null}
        {ready.length > 0 ? (
          <Button variant="primary" disabled={busy || isStale} onClick={() => void handleConfirm()}>
            {isSaving ? t.simpleScenes.slotBulk.saving : t.simpleScenes.slotBulk.confirmAction(ready.length)}
          </Button>
        ) : null}
      </div>
      <p className="slot-bulk-review__hint">{t.simpleScenes.slotBulk.hint}</p>
    </Card>
  );
}
