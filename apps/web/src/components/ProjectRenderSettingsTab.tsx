"use client";

import { useEffect, useState, type ReactElement } from "react";
import { RENDER_OUTPUT_VARIANTS, type Composition, type ExecutionSessionDto, type RenderOutputConfig, type RenderOutputVariant } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";
import { dispatchJob, fetchCurrentExecutionSession } from "../lib/projects-api-client";
import { findDispatchableWorker } from "../lib/find-dispatchable-worker";

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
    </div>
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
  const renderWorkerOnline = renderWorker !== null && renderWorker.status === "ONLINE" && renderWorker.currentJobId === null;
  const canRender = currentConfig !== null && !isStale && renderReady && renderWorkerOnline;
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
    if (!renderWorker || !session) {
      return;
    }
    setIsDispatching(true);
    setDispatchError(null);
    setDispatchSuccess(null);
    const result = await dispatchJob({
      operation: "RENDER",
      workerId: renderWorker.workerId,
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
      <CardHeader title={t.projectWorkspace.renderSettings.variantSection[variant]} />

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
          ) : currentConfig && !isStale && renderReady && !renderWorkerOnline ? (
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
