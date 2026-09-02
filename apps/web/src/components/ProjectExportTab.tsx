"use client";

import { useEffect, useState, type ReactElement } from "react";
import { RENDER_OUTPUT_VARIANTS, type ExecutionSessionDto, type RenderOutputConfig, type RenderOutputVariant } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";
import { dispatchJob, fetchCurrentExecutionSession } from "../lib/projects-api-client";
import { FinalOutputsCard } from "./ProjectRenderSettingsTab";

/**
 * "Export" tab (final MVP nav, client-facing UX redesign section H,
 * finalized) - a plain-language render trigger plus the same real,
 * server-verified download/playback list Advanced's Render Settings tab
 * already shows (FinalOutputsCard, reused unchanged). Deliberately never
 * exposes the raw master-composition picker or the AE Render Settings/
 * Output Module TEMPLATE NAME fields (ProjectRenderSettingsTab's
 * VariantConfigCard) - configuring those stays an Advanced-only action;
 * this tab only ever dispatches RENDER against whatever configuration
 * already exists, exactly like every other dispatch in this codebase
 * (never accepts a composition/template field from the browser directly -
 * see resolve-render-dispatch.ts).
 */
export function ProjectExportTab(): ReactElement | null {
  const { t } = useLocale();
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

  if (!plan) {
    return (
      <Card>
        <EmptyState title={t.projectWorkspace.noPlanTitle} description={t.projectWorkspace.noPlanDescription} />
      </Card>
    );
  }

  const projectId = project.project.projectId;
  // Same real gate resolve-render-dispatch.ts itself enforces server-side -
  // mirrored here only for UI honesty, never the actual enforcement.
  const renderReady = session !== null && (session.status === "READY_TO_RENDER" || session.status === "COMPLETED");

  return (
    <div className="overview-grid">
      <Card className="overview-section">
        <CardHeader title={t.projectWorkspace.tabs.export} />
        <p>{t.projectWorkspace.export.description}</p>
      </Card>

      {RENDER_OUTPUT_VARIANTS.map((variant) => (
        <SimpleExportVariantCard
          key={variant}
          projectId={projectId}
          variant={variant}
          currentConfig={plan.plan.renderOutputs[variant] ?? null}
          currentSourceSha={project.manifest.sourceProject.sha256}
          session={session}
          renderReady={renderReady}
        />
      ))}

      <FinalOutputsCard projectId={projectId} />
    </div>
  );
}

function SimpleExportVariantCard({
  projectId,
  variant,
  currentConfig,
  currentSourceSha,
  session,
  renderReady
}: {
  projectId: string;
  variant: RenderOutputVariant;
  currentConfig: RenderOutputConfig | null;
  currentSourceSha: string;
  session: ExecutionSessionDto | null;
  renderReady: boolean;
}): ReactElement {
  const { t } = useLocale();
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);

  const isStale = currentConfig !== null && currentConfig.sourceProjectSha256 !== currentSourceSha;
  // RENDER is always pinned to the execution session's own assigned worker
  // (worker affinity, section 8) - never re-chosen the way the very first
  // EXECUTE_FRAME dispatch is (same lookup ProjectRenderSettingsTab's own
  // VariantConfigCard uses - a plain find-by-id, never the generic
  // "any dispatchable worker" heuristic, since this always targets one
  // specific, already-pinned worker).
  const renderWorker = session ? (dashboardStatus?.workers ?? []).find((w) => w.workerId === session.assignedWorkerId) ?? null : null;
  const renderWorkerOnline = renderWorker !== null && renderWorker.status === "ONLINE" && renderWorker.currentJobId === null;
  const canRender = currentConfig !== null && !isStale && renderReady && renderWorkerOnline;
  const isKnownWorkerOffline = renderWorker !== null && renderWorker.status !== "ONLINE";
  const variantLabel = t.renders.variantLabel[variant];

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
    setDispatchSuccess(t.jobDispatch.startedHint);
  }

  return (
    <Card className="overview-section">
      <CardHeader title={variantLabel} />

      {currentConfig === null || isStale ? (
        <EmptyState title={t.projectWorkspace.export.notConfiguredTitle} description={t.projectWorkspace.export.notConfiguredDescription} />
      ) : !renderReady ? (
        <EmptyState title={t.projectWorkspace.export.notReadyTitle} description={t.projectWorkspace.export.notReadyDescription} />
      ) : !renderWorkerOnline ? (
        isKnownWorkerOffline ? (
          <EmptyState title={t.jobDispatch.workerOfflineTitle} description={t.jobDispatch.workerOfflineDescription} />
        ) : (
          <EmptyState title={t.jobDispatch.noWorkerTitle} description={t.jobDispatch.noWorkerDescription} />
        )
      ) : null}
      {dispatchError ? <ErrorState title={t.jobDispatch.failedTitle} description={dispatchError} /> : null}
      {dispatchSuccess ? <p role="status">{dispatchSuccess}</p> : null}

      <div className="overview-actions">
        <Button variant="primary" disabled={!canRender || isDispatching} onClick={() => void handleRender()}>
          {isDispatching ? t.jobDispatch.dispatching : t.projectWorkspace.export.renderAction(variantLabel)}
        </Button>
      </div>
    </Card>
  );
}
