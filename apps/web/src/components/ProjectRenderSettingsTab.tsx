"use client";

import { useEffect, useState, type ReactElement } from "react";
import {
  RENDER_OUTPUT_VARIANTS,
  sceneEvidenceResponseSchema,
  type Composition,
  type ExecutionPlanResponse,
  type ExecutionSessionDto,
  type RenderOutputConfig,
  type RenderOutputVariant
} from "@dyo/schemas";
import type { RenderArtifactDto } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { useRenderArtifacts } from "../lib/use-render-artifacts";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Skeleton } from "./ui/Skeleton";
import { VideoArtifactPlayer } from "./ui/VideoArtifactPlayer";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { HelpTooltip } from "./ui/HelpTooltip";
import { useLocale } from "./LocaleProvider";
import { dispatchJob, fetchCurrentExecutionSession, fetchJobStatus, renderArtifactFileUrl } from "../lib/projects-api-client";
import { findDispatchableWorker } from "../lib/find-dispatchable-worker";
import { resolveProjectWorker } from "../lib/resolve-project-worker";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Real Output Config UI (render-delivery phase section 2) - the composition
 * picker is sourced ONLY from `project.manifest.compositions` (the same
 * already-loaded manifest ProjectOverviewTab/ProjectScenesTab read), never
 * an arbitrary numeric index field. Saving goes through
 * useProjectWorkspaceContext().setRenderOutput, which calls the real
 * PUT .../render-outputs/:variant endpoint - the server re-resolves
 * aeProjectItemIndex/compositionName itself from manifestCompositionId
 * (see set-render-output-config.ts); nothing here ever sends those two
 * fields directly.
 */
export function ProjectRenderSettingsTab(): ReactElement | null {
  const { project, plan } = useProjectWorkspaceContext();
  const [session, setSession] = useState<ExecutionSessionDto | null>(null);

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
  }, [projectIdForEffect]);

  if (!project) {
    return null;
  }

  const compositions = project.manifest.compositions;
  const projectId = project.project.projectId;
  // RENDER can only ever dispatch from a session that has actually reached
  // READY_TO_RENDER (every approved scene executed + preview approved) or
  // has already COMPLETED one variant (still eligible to render the other -
  // section 15: the session stays recoverable) - see resolveRenderDispatch's
  // own server-side gate, mirrored here only for UI honesty.
  const renderReady = session !== null && (session.status === "READY_TO_RENDER" || session.status === "COMPLETED");

  return (
    <div className="overview-grid">
      <InspectRenderCapabilitiesCard />
      <BuildHorizontalCompositionCard projectId={projectId} session={session} />
      <DescribeCompositionTimelineCard projectId={projectId} session={session} plan={plan} />
      <DescribeAnyCompositionCard projectId={projectId} session={session} />
      {RENDER_OUTPUT_VARIANTS.map((variant) => (
        <VariantConfigCard
          key={variant}
          projectId={projectId}
          variant={variant}
          compositions={compositions}
          currentConfig={plan?.plan.renderOutputs[variant] ?? null}
          currentSourceSha={project.manifest.sourceProject.sha256}
          session={session}
          renderReady={renderReady}
        />
      ))}
      <FinalOutputsCard projectId={projectId} />
    </div>
  );
}

/**
 * Client-handoff phase, section S ("Final Outputs / Downloads") - a real,
 * project-scoped view of every completed render artifact, with an actual
 * video player (never metadata-only) and the existing authenticated
 * download link. Never shows "Download ready" for anything that isn't a
 * real, server-confirmed render_artifacts row (list-render-artifacts.ts
 * only ever returns genuinely persisted, VALID artifacts - see that
 * file's own doc comment).
 */
/** Exported for reuse by ProjectExportTab.tsx (the Simple-mode "Export" tab) - the exact same real download/playback list, never a separate implementation. */
export function FinalOutputsCard({ projectId }: { projectId: string }): ReactElement {
  const { t } = useLocale();
  const { artifacts, isLoading, error } = useRenderArtifacts(projectId);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  return (
    <Card className="overview-section final-outputs-card">
      <CardHeader title={t.renders.finalOutputsTitle} />
      <p>{t.renders.finalOutputsDescription}</p>
      {isLoading ? (
        <Skeleton height="1.5rem" />
      ) : error ? (
        <ErrorState title={t.renders.loadErrorTitle} description={error} />
      ) : !artifacts || artifacts.length === 0 ? (
        <EmptyState title={t.renders.emptyTitle} description={t.renders.emptyDescription} />
      ) : (
        <ul className="final-outputs-card__list">
          {artifacts.map((artifact: RenderArtifactDto) => (
            <li key={artifact.id} className="final-outputs-card__item">
              <div className="final-outputs-card__facts">
                <span className="final-outputs-card__variant">{t.renders.variantLabel[artifact.variant]}</span>
                <span className="status-badge status-badge--positive">{t.renders.statusComplete}</span>
                <span className="field__hint">{new Date(artifact.renderCompletedAt).toLocaleString()}</span>
                <span className="field__hint">{formatBytes(artifact.byteSize)}</span>
              </div>
              <div className="final-outputs-card__actions">
                <Button size="sm" variant="secondary" onClick={() => setPreviewingId(previewingId === artifact.id ? null : artifact.id)}>
                  {previewingId === artifact.id ? t.renders.hidePreviewAction : t.renders.previewAction}
                </Button>
                <a className="btn btn--secondary btn--sm" href={renderArtifactFileUrl(projectId, artifact.id)}>
                  {t.renders.downloadAction}
                </a>
              </div>
              {previewingId === artifact.id ? (
                <VideoArtifactPlayer src={renderArtifactFileUrl(projectId, artifact.id)} ariaLabel={`${t.renders.variantLabel[artifact.variant]} - ${artifact.compositionName}`} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function InspectRenderCapabilitiesCard(): ReactElement {
  const { t } = useLocale();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);

  const worker = findDispatchableWorker(dashboardStatus?.workers ?? null, "INSPECT_RENDER_CAPABILITIES");

  async function handleInspect(): Promise<void> {
    if (!worker) {
      return;
    }
    setIsDispatching(true);
    setDispatchError(null);
    setDispatchSuccess(null);
    // Not project-bound - see job-dispatch.ts's own doc comment.
    const result = await dispatchJob({ operation: "INSPECT_RENDER_CAPABILITIES", workerId: worker.workerId, payload: {} });
    setIsDispatching(false);
    if (!result.ok) {
      setDispatchError(result.message);
      return;
    }
    setDispatchSuccess(t.jobDispatch.queuedDescription(result.data.jobId));
  }

  return (
    <Card className="overview-section">
      <CardHeader title={t.projectWorkspace.renderSettings.inspectCapabilitiesSection} />
      <p>{t.projectWorkspace.renderSettings.inspectCapabilitiesDescription}</p>
      {!worker ? <EmptyState title={t.jobDispatch.noWorkerTitle} description={t.jobDispatch.noWorkerDescription} /> : null}
      {dispatchError ? <ErrorState title={t.jobDispatch.failedTitle} description={dispatchError} /> : null}
      {dispatchSuccess ? <p role="status">{dispatchSuccess}</p> : null}
      <div className="overview-actions">
        <Button variant="secondary" disabled={!worker || isDispatching} onClick={() => void handleInspect()}>
          {isDispatching ? t.jobDispatch.dispatching : t.projectWorkspace.renderSettings.inspectCapabilitiesAction}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Landscape output-composition build (live QA, 2026-09-10 urgent request:
 * "COMPLETE THE MISSING OUTPUT-COMPOSITION STAGE") - dispatches the new
 * one-shot BUILD_HORIZONTAL_COMPOSITION operation for the session's own
 * already-executed master/preview scene (`session.latestPreviewScenePlanId`
 * - the exact same field regeneratePreviewOnly already targets for the
 * same reason: that scene's own approved content is already baked into the
 * working copy). Once the dispatched job succeeds, the new Landscape
 * composition is registered onto the project's manifest automatically (see
 * register-horizontal-composition.ts) and appears in the composition
 * dropdown below with zero further action here - this card only ever
 * triggers the build, it never reads back or selects the result itself.
 */
function BuildHorizontalCompositionCard({ projectId, session }: { projectId: string; session: ExecutionSessionDto | null }): ReactElement | null {
  const { t } = useLocale();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);

  if (!session || session.latestPreviewScenePlanId === null) {
    return null;
  }
  const scenePlanId = session.latestPreviewScenePlanId;
  const ready = session.completedScenePlanIds.includes(scenePlanId);
  // Same worker-affinity resolution as every other session-scoped dispatch
  // in this file (RENDER above) - the session's cumulative working copy
  // exists only on its own assigned worker's local disk.
  const worker = resolveProjectWorker(dashboardStatus?.workers ?? null, "EXECUTE_FRAME", session.assignedWorkerId);

  async function handleBuild(): Promise<void> {
    if (!worker || !session) {
      return;
    }
    setIsDispatching(true);
    setDispatchError(null);
    setDispatchSuccess(null);
    const result = await dispatchJob({
      operation: "EXECUTE_FRAME",
      workerId: worker.workerId,
      projectId,
      executionSessionId: session.id,
      scenePlanId,
      buildHorizontalCompositionOnly: true
    });
    setIsDispatching(false);
    if (!result.ok) {
      setDispatchError(result.message);
      return;
    }
    setDispatchSuccess(t.jobDispatch.queuedDescription(result.data.jobId));
  }

  return (
    <Card className="overview-section">
      <CardHeader title={t.projectWorkspace.renderSettings.buildHorizontalSection} />
      <p>{t.projectWorkspace.renderSettings.buildHorizontalDescription}</p>
      {!ready ? (
        <EmptyState title={t.projectWorkspace.renderSettings.buildHorizontalNotReadyTitle} description={t.projectWorkspace.renderSettings.buildHorizontalNotReadyDescription} />
      ) : !worker ? (
        <EmptyState title={t.jobDispatch.noWorkerTitle} description={t.jobDispatch.noWorkerDescription} />
      ) : null}
      {dispatchError ? <ErrorState title={t.jobDispatch.failedTitle} description={dispatchError} /> : null}
      {dispatchSuccess ? <p role="status">{dispatchSuccess}</p> : null}
      <div className="overview-actions">
        <Button variant="secondary" disabled={!ready || !worker || isDispatching} onClick={() => void handleBuild()}>
          {isDispatching ? t.jobDispatch.dispatching : t.projectWorkspace.renderSettings.buildHorizontalAction}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Real 2026-09-10 incident (session a7fee3d9) - a genuinely minimal,
 * read-only diagnostic: dispatches the new describeCompositionSummary
 * scan (buildDescribeCompositionSummaryScript) against whichever real
 * composition is currently configured as a master (LANDSCAPE/REELS render
 * output) - never a hardcoded compositionId, always whatever this
 * project's own current render_outputs config says. Reports the real
 * comp-level duration/work-area facts and every top-level layer's own
 * timing directly in the card (never merely "queued") - never guesses
 * whether a master's own approved timeline is actually fully populated.
 */
function DescribeCompositionTimelineCard({
  projectId,
  session,
  plan
}: {
  projectId: string;
  session: ExecutionSessionDto | null;
  plan: ExecutionPlanResponse | null;
}): ReactElement | null {
  const { t } = useLocale();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [isDispatching, setIsDispatching] = useState<RenderOutputVariant | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { jobId: string; text: string } | { jobId: string; error: string }>>({});

  if (!session || session.latestPreviewScenePlanId === null || !plan) {
    return null;
  }
  const scenePlanId = session.latestPreviewScenePlanId;
  const worker = resolveProjectWorker(dashboardStatus?.workers ?? null, "INSPECT_SCENE_EVIDENCE", session.assignedWorkerId);

  async function handleDescribe(variant: RenderOutputVariant): Promise<void> {
    const config = plan?.plan.renderOutputs[variant] ?? null;
    if (!worker || !config) {
      return;
    }
    setIsDispatching(variant);
    setDispatchError(null);
    const dispatched = await dispatchJob({
      operation: "INSPECT_SCENE_EVIDENCE",
      workerId: worker.workerId,
      projectId,
      scenePlanId,
      previewTimingDiscoverCompositionId: config.manifestCompositionId,
      previewTimingDescribeCompositionSummary: true
    });
    if (!dispatched.ok) {
      setIsDispatching(null);
      setDispatchError(dispatched.message);
      return;
    }
    for (;;) {
      const status = await fetchJobStatus(dispatched.data.jobId);
      if (!status.ok) {
        setIsDispatching(null);
        setResults((prev) => ({ ...prev, [variant]: { jobId: dispatched.data.jobId, error: status.message } }));
        return;
      }
      if (status.data.status === "SUCCEEDED" || status.data.status === "FAILED" || status.data.status === "CANCELLED") {
        setIsDispatching(null);
        if (status.data.status !== "SUCCEEDED") {
          setResults((prev) => ({ ...prev, [variant]: { jobId: dispatched.data.jobId, error: status.data.error?.message ?? status.data.status } }));
          return;
        }
        const parsedResult = sceneEvidenceResponseSchema.safeParse(status.data.result);
        if (!parsedResult.success) {
          setResults((prev) => ({ ...prev, [variant]: { jobId: dispatched.data.jobId, error: "result did not match the expected shape" } }));
          return;
        }
        if (!parsedResult.data.compositionSummary) {
          setResults((prev) => ({
            ...prev,
            [variant]: { jobId: dispatched.data.jobId, error: parsedResult.data.compositionSummaryFailureReason ?? "no compositionSummary in result" }
          }));
          return;
        }
        const s = parsedResult.data.compositionSummary;
        const layerLines = s.layers
          .map(
            (l) =>
              `#${l.layerIndex} "${l.layerName}" enabled=${l.enabled} in=${l.inPointSeconds.toFixed(3)} out=${l.outPointSeconds.toFixed(3)} start=${l.startTimeSeconds.toFixed(3)}${l.sourceCompositionId ? ` source=${l.sourceCompositionId}(${l.sourceDurationSeconds?.toFixed(3)}s)` : ""}`
          )
          .join("\n");
        const text = `compDuration=${s.compDurationSeconds.toFixed(6)}s workAreaStart=${s.workAreaStartSeconds.toFixed(6)}s workAreaDuration=${s.workAreaDurationSeconds.toFixed(6)}s frameRate=${s.frameRate.toFixed(6)}\n${layerLines}`;
        setResults((prev) => ({ ...prev, [variant]: { jobId: dispatched.data.jobId, text } }));
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    }
  }

  return (
    <Card className="overview-section">
      <CardHeader title="Composition timeline diagnostics" />
      <p>Read-only. Reports the real, worker-observed duration/work-area and every top-level layer&apos;s own timing for the currently configured Landscape/Reels master.</p>
      {!worker ? <EmptyState title={t.jobDispatch.noWorkerTitle} description={t.jobDispatch.noWorkerDescription} /> : null}
      {dispatchError ? <ErrorState title={t.jobDispatch.failedTitle} description={dispatchError} /> : null}
      <div className="overview-actions">
        {RENDER_OUTPUT_VARIANTS.map((variant) => (
          <Button
            key={variant}
            variant="secondary"
            disabled={!worker || isDispatching !== null || !plan.plan.renderOutputs[variant]}
            onClick={() => void handleDescribe(variant)}
          >
            {isDispatching === variant ? t.jobDispatch.dispatching : `Describe ${variant} timeline`}
          </Button>
        ))}
      </div>
      {RENDER_OUTPUT_VARIANTS.map((variant) => {
        const result = results[variant];
        if (!result) return null;
        return (
          <div key={variant}>
            <p>
              <strong>{variant}</strong> (job {result.jobId}):
            </p>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.75rem" }}>{"text" in result ? result.text : `ERROR: ${result.error}`}</pre>
          </div>
        );
      })}
    </Card>
  );
}

/**
 * Real 2026-09-11 audit incident: DescribeCompositionTimelineCard above
 * only ever targets the two configured render-output master compositions
 * (LANDSCAPE/REELS) - auditing why a nested scene (e.g. "Scene 1"/comp-1)
 * goes black partway through its own timeline needs the SAME
 * describeCompositionSummary capability pointed at an arbitrary NESTED
 * composition instead. resolveInspectSceneEvidenceDispatch.ts's own
 * previewTimingDiscoverCompositionId resolution is already fully generic
 * - it validates any caller-supplied compositionId against the project's
 * OWN current manifest (never an arbitrary/unvalidated string) and
 * resolves its real aeProjectItemIndex/name server-side - so this needed
 * zero backend or worker changes, only a UI to reach a target other than
 * the two masters. Read-only, same as every other diagnostic in this
 * file: only ever dispatches INSPECT_SCENE_EVIDENCE, never mutates
 * anything.
 */
function DescribeAnyCompositionCard({ projectId, session }: { projectId: string; session: ExecutionSessionDto | null }): ReactElement | null {
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [compositionId, setCompositionId] = useState("");
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [result, setResult] = useState<{ jobId: string; text: string } | { jobId: string; error: string } | null>(null);

  if (!session || session.latestPreviewScenePlanId === null) {
    return null;
  }
  const scenePlanId = session.latestPreviewScenePlanId;
  const worker = resolveProjectWorker(dashboardStatus?.workers ?? null, "INSPECT_SCENE_EVIDENCE", session.assignedWorkerId);

  async function handleDescribe(): Promise<void> {
    const targetId = compositionId.trim();
    if (!worker || targetId.length === 0) {
      return;
    }
    setIsDispatching(true);
    setDispatchError(null);
    setResult(null);
    const dispatched = await dispatchJob({
      operation: "INSPECT_SCENE_EVIDENCE",
      workerId: worker.workerId,
      projectId,
      scenePlanId,
      previewTimingDiscoverCompositionId: targetId,
      previewTimingDescribeCompositionSummary: true
    });
    if (!dispatched.ok) {
      setIsDispatching(false);
      setDispatchError(dispatched.message);
      return;
    }
    for (;;) {
      const status = await fetchJobStatus(dispatched.data.jobId);
      if (!status.ok) {
        setIsDispatching(false);
        setResult({ jobId: dispatched.data.jobId, error: status.message });
        return;
      }
      if (status.data.status === "SUCCEEDED" || status.data.status === "FAILED" || status.data.status === "CANCELLED") {
        setIsDispatching(false);
        if (status.data.status !== "SUCCEEDED") {
          setResult({ jobId: dispatched.data.jobId, error: status.data.error?.message ?? status.data.status });
          return;
        }
        const parsedResult = sceneEvidenceResponseSchema.safeParse(status.data.result);
        if (!parsedResult.success) {
          setResult({ jobId: dispatched.data.jobId, error: "result did not match the expected shape" });
          return;
        }
        if (!parsedResult.data.compositionSummary) {
          setResult({ jobId: dispatched.data.jobId, error: parsedResult.data.compositionSummaryFailureReason ?? "no compositionSummary in result" });
          return;
        }
        const s = parsedResult.data.compositionSummary;
        const layerLines = s.layers
          .map(
            (l) =>
              `#${l.layerIndex} "${l.layerName}" enabled=${l.enabled} in=${l.inPointSeconds.toFixed(3)} out=${l.outPointSeconds.toFixed(3)} start=${l.startTimeSeconds.toFixed(3)}${l.sourceCompositionId ? ` source=${l.sourceCompositionId}(${l.sourceDurationSeconds?.toFixed(3)}s)` : ""}`
          )
          .join("\n");
        const text = `compDuration=${s.compDurationSeconds.toFixed(6)}s workAreaStart=${s.workAreaStartSeconds.toFixed(6)}s workAreaDuration=${s.workAreaDurationSeconds.toFixed(6)}s frameRate=${s.frameRate.toFixed(6)}\n${layerLines}`;
        setResult({ jobId: dispatched.data.jobId, text });
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    }
  }

  return (
    <Card className="overview-section">
      <CardHeader title="Describe any composition (by manifest composition ID)" />
      <p>Read-only. Reports the real, worker-observed duration/work-area and every top-level layer&apos;s own timing for ANY composition in this project&apos;s manifest - e.g. a nested scene like &quot;comp-1&quot; (Scene 1), not just the configured Landscape/Reels masters.</p>
      {!worker ? <EmptyState title="No worker available" description="This project's assigned worker is not currently reporting INSPECT_SCENE_EVIDENCE." /> : null}
      {dispatchError ? <ErrorState title="Dispatch failed" description={dispatchError} /> : null}
      <Field label="Manifest composition ID" htmlFor="describe-any-composition-id">
        <Input id="describe-any-composition-id" value={compositionId} onChange={(e) => setCompositionId(e.target.value)} placeholder="e.g. comp-1" disabled={isDispatching} />
      </Field>
      <div className="overview-actions">
        <Button variant="secondary" disabled={!worker || isDispatching || compositionId.trim().length === 0} onClick={() => void handleDescribe()}>
          {isDispatching ? "Dispatching…" : "Describe composition"}
        </Button>
      </div>
      {result ? (
        <div>
          <p>
            <strong>{compositionId.trim()}</strong> (job {result.jobId}):
          </p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.75rem" }}>{"text" in result ? result.text : `ERROR: ${result.error}`}</pre>
        </div>
      ) : null}
    </Card>
  );
}

function VariantConfigCard({
  projectId,
  variant,
  compositions,
  currentConfig,
  currentSourceSha,
  session,
  renderReady
}: {
  projectId: string;
  variant: RenderOutputVariant;
  compositions: Composition[];
  currentConfig: RenderOutputConfig | null;
  currentSourceSha: string;
  session: ExecutionSessionDto | null;
  renderReady: boolean;
}): ReactElement {
  const { t } = useLocale();
  const { setRenderOutput } = useProjectWorkspaceContext();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [manifestCompositionId, setManifestCompositionId] = useState(currentConfig?.manifestCompositionId ?? "");
  const [renderSettingsTemplateName, setRenderSettingsTemplateName] = useState(currentConfig?.renderSettingsTemplateName ?? "");
  const [outputModuleTemplateName, setOutputModuleTemplateName] = useState(currentConfig?.outputModuleTemplateName ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);

  const isStale = currentConfig !== null && currentConfig.sourceProjectSha256 !== currentSourceSha;
  const selectedComposition = compositions.find((c) => c.compositionId === manifestCompositionId) ?? null;
  const canSave = manifestCompositionId !== "" && renderSettingsTemplateName.trim() !== "" && outputModuleTemplateName.trim() !== "";
  // RENDER is always pinned to the execution session's own assigned worker
  // (worker affinity, section 8) - never re-chosen the way EXECUTE_FRAME's
  // very first dispatch is.
  const renderWorker = session ? (dashboardStatus?.workers ?? []).find((w) => w.workerId === session.assignedWorkerId) ?? null : null;
  // Selection precondition consistency (live QA Blocker 1, section 5): the
  // actual dispatch candidate is health-gated (AE/MCP ONLINE + capability),
  // not just "status ONLINE and idle" - resolveProjectWorker fails closed
  // to null rather than ever substituting a different worker.
  const dispatchableRenderWorker = resolveProjectWorker(dashboardStatus?.workers ?? null, "RENDER", session?.assignedWorkerId ?? null);
  const canRender = currentConfig !== null && !isStale && renderReady && dispatchableRenderWorker !== null;
  const isKnownWorkerOffline = renderWorker !== null && renderWorker.status !== "ONLINE";

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    const result = await setRenderOutput(variant, {
      manifestCompositionId,
      renderSettingsTemplateName: renderSettingsTemplateName.trim(),
      outputModuleTemplateName: outputModuleTemplateName.trim()
    });
    setIsSaving(false);
    if (!result.ok) {
      setSaveError(result.message ?? null);
    }
  }

  async function handleRender(): Promise<void> {
    if (!dispatchableRenderWorker || !session) {
      return;
    }
    setIsDispatching(true);
    setDispatchError(null);
    setDispatchSuccess(null);
    const result = await dispatchJob({
      operation: "RENDER",
      workerId: dispatchableRenderWorker.workerId,
      projectId,
      executionSessionId: session.id,
      variant
    });
    setIsDispatching(false);
    if (!result.ok) {
      setDispatchError(result.message);
      return;
    }
    setDispatchSuccess(t.jobDispatch.queuedDescription(result.data.jobId));
  }

  return (
    <Card className="overview-section">
      <CardHeader
        title={
          <>
            {t.projectWorkspace.renderSettings.variantSection[variant]}
            <HelpTooltip text={variant === "REELS" ? t.helpTooltips.reels : t.helpTooltips.landscape} />
          </>
        }
      />

      {compositions.length === 0 ? (
        <EmptyState
          title={t.projectWorkspace.renderSettings.noCompositionsTitle}
          description={t.projectWorkspace.renderSettings.noCompositionsDescription}
        />
      ) : (
        <>
          {isStale ? (
            <ErrorState
              title={t.projectWorkspace.renderSettings.staleWarningTitle}
              description={t.projectWorkspace.renderSettings.staleWarningDescription}
            />
          ) : null}

          <Field label={t.projectWorkspace.renderSettings.compositionLabel} htmlFor={`render-composition-${variant}`}>
            <Select
              id={`render-composition-${variant}`}
              value={manifestCompositionId}
              disabled={isSaving}
              onChange={(event) => setManifestCompositionId(event.target.value)}
            >
              <option value="">{t.projectWorkspace.renderSettings.compositionPlaceholder}</option>
              {compositions.map((composition) => (
                <option key={composition.compositionId} value={composition.compositionId}>
                  {composition.name} ({composition.widthPx}×{composition.heightPx})
                </option>
              ))}
            </Select>
          </Field>

          {selectedComposition ? (
            <dl className="overview-fact-list">
              <div>
                <dt>{t.projectWorkspace.renderSettings.compositionLabel}</dt>
                <dd>{selectedComposition.name}</dd>
              </div>
              <div>
                <dt>{t.projectWorkspace.renderSettings.compositionIdentityLabel}</dt>
                <dd>
                  <code>{selectedComposition.compositionId}</code>
                </dd>
              </div>
              <div>
                <dt>{t.projectWorkspace.renderSettings.dimensionsLabel}</dt>
                <dd>
                  {selectedComposition.widthPx}×{selectedComposition.heightPx}
                </dd>
              </div>
            </dl>
          ) : null}

          <Field
            label={t.projectWorkspace.renderSettings.renderSettingsTemplateLabel}
            htmlFor={`render-rs-template-${variant}`}
            hint={t.projectWorkspace.renderSettings.templateHint}
          >
            <Input
              id={`render-rs-template-${variant}`}
              value={renderSettingsTemplateName}
              disabled={isSaving}
              onChange={(event) => setRenderSettingsTemplateName(event.target.value)}
            />
          </Field>

          <Field label={t.projectWorkspace.renderSettings.outputModuleTemplateLabel} htmlFor={`render-om-template-${variant}`}>
            <Input
              id={`render-om-template-${variant}`}
              value={outputModuleTemplateName}
              disabled={isSaving}
              onChange={(event) => setOutputModuleTemplateName(event.target.value)}
            />
          </Field>

          {saveError ? <ErrorState title={t.projectWorkspace.renderSettings.saveFailedTitle} description={saveError} /> : null}

          {currentConfig && !isStale ? (
            <p className="overview-section__ready-title">
              {t.projectWorkspace.renderSettings.savedConfiguredAt(new Date(currentConfig.configuredAt).toLocaleString())}
            </p>
          ) : null}

          {currentConfig && !isStale && !renderReady ? (
            <EmptyState title={t.projectWorkspace.renderSettings.sessionNotReadyTitle} description={t.projectWorkspace.renderSettings.sessionNotReadyDescription} />
          ) : currentConfig && !isStale && renderReady && !dispatchableRenderWorker ? (
            isKnownWorkerOffline ? (
              <EmptyState title={t.jobDispatch.workerOfflineTitle} description={t.jobDispatch.workerOfflineDescription} />
            ) : (
              <EmptyState title={t.jobDispatch.noWorkerTitle} description={t.jobDispatch.noWorkerDescription} />
            )
          ) : null}
          {dispatchError ? <ErrorState title={t.jobDispatch.failedTitle} description={dispatchError} /> : null}
          {dispatchSuccess ? <p role="status">{dispatchSuccess}</p> : null}

          <div className="overview-actions">
            <Button variant="primary" disabled={!canSave || isSaving} onClick={() => void handleSave()}>
              {isSaving ? t.projectWorkspace.renderSettings.savingLabel : t.projectWorkspace.renderSettings.saveAction}
            </Button>
            <Button variant="secondary" disabled={!canRender || isDispatching} onClick={() => void handleRender()}>
              {isDispatching ? t.jobDispatch.dispatching : t.projectWorkspace.renderSettings.renderAction}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
