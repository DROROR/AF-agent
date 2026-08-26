"use client";

import { useState, type ReactElement } from "react";
import { getExecutionPlanReadiness } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { PlanStatusBadge } from "./PlanStatusBadge";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";

/**
 * Real Overview tab (dashboard-integration task section 4) - every value
 * here comes from the real project/execution-plan API responses already
 * loaded by ProjectWorkspaceProvider. Approval readiness uses
 * getExecutionPlanReadiness from @dyo/schemas - the SAME shared predicate
 * approve-execution-plan.ts enforces server-side, so this UI can never
 * claim a plan is ready when the backend would actually refuse it (and
 * vice versa). The "Approve plan" button is disabled whenever it isn't
 * ready, with the reason shown - never a silently-disabled button with no
 * explanation - but this is a UX convenience, not the enforcement: a
 * direct API call is independently refused with PRECONDITION_NOT_MET.
 */
export function ProjectOverviewTab(): ReactElement | null {
  const { t } = useLocale();
  const { project, plan, approve, reject, reopen, isStale, refetch } = useProjectWorkspaceContext();
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!project) {
    // Unreachable in practice - ProjectWorkspaceShell only renders tab
    // children once `project` has loaded - but typed defensively since
    // this component reads the same shared context independently.
    return null;
  }

  if (!plan) {
    return (
      <Card>
        <EmptyState title={t.projectWorkspace.noPlanTitle} description={t.projectWorkspace.noPlanDescription} />
      </Card>
    );
  }

  const readiness = getExecutionPlanReadiness(plan.plan.scenePlans);
  const mappingCount = plan.plan.scenePlans.reduce((sum, scene) => sum + scene.mappings.length, 0);
  const isReady = readiness.ready && plan.plan.status === "DRAFT";

  async function runAction(action: () => Promise<{ ok: boolean; message?: string }>): Promise<void> {
    setIsSubmitting(true);
    setActionError(null);
    const result = await action();
    if (!result.ok) {
      setActionError(result.message ?? null);
    }
    setIsSubmitting(false);
  }

  return (
    <div className="overview-grid">
      <Card className="overview-section">
        <CardHeader title={t.projectWorkspace.overview.projectSection} />
        <dl className="overview-fact-list">
          <div>
            <dt>{t.projectWorkspace.header.sourceProject}</dt>
            <dd>{project.manifest.sourceProject.name}</dd>
          </div>
          <div>
            <dt>{t.projectWorkspace.header.sourceSha}</dt>
            <dd>
              <code>{project.manifest.sourceProject.sha256.slice(0, 12)}</code>
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="overview-section">
        <CardHeader title={t.projectWorkspace.overview.planSection} action={<PlanStatusBadge status={plan.plan.status} />} />
        <dl className="overview-fact-list">
          <div>
            <dt>{t.projectWorkspace.header.revision}</dt>
            <dd>{plan.plan.revision}</dd>
          </div>
          <div>
            <dt>{t.projectWorkspace.header.scenes}</dt>
            <dd>{plan.plan.scenePlans.length}</dd>
          </div>
          <div>
            <dt>{t.projectWorkspace.header.unresolved}</dt>
            <dd>{readiness.unresolvedSceneCount}</dd>
          </div>
          <div>
            <dt>{t.projectWorkspace.overview.mappingCount}</dt>
            <dd>{mappingCount}</dd>
          </div>
        </dl>
      </Card>

      <Card className="overview-section">
        <CardHeader title={t.projectWorkspace.overview.safetySection} />
        <dl className="overview-fact-list">
          <div>
            <dt>{t.projectWorkspace.overview.approvedLabel}</dt>
            <dd>
              {plan.plan.status === "APPROVED"
                ? plan.plan.approvedAt
                  ? t.projectWorkspace.overview.approvedByAt(plan.plan.approvedBy ?? "—", new Date(plan.plan.approvedAt).toLocaleString())
                  : t.projectWorkspace.overview.approvedLabel
                : t.projectWorkspace.overview.notApprovedLabel}
            </dd>
          </div>
        </dl>
        <p className="overview-section__ready-title">
          {isReady ? t.projectWorkspace.overview.readyTitle : t.projectWorkspace.overview.notReadyTitle}
        </p>
        {!isReady && plan.plan.status === "DRAFT" ? (
          <>
            <p>{t.projectWorkspace.overview.blockedReasonsIntro}</p>
            <ul className="overview-blocked-reasons">
              {readiness.unresolvedSceneCount > 0 ? <li>{t.projectWorkspace.overview.unresolvedScenesReason(readiness.unresolvedSceneCount)}</li> : null}
            </ul>
          </>
        ) : null}

        {isStale ? (
          <ErrorState title={t.projectWorkspace.staleRevisionTitle} description={t.projectWorkspace.staleRevisionDescription} />
        ) : null}
        {isStale ? (
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            {t.projectWorkspace.reload}
          </Button>
        ) : null}
        {actionError ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={actionError} /> : null}

        <div className="overview-actions">
          {plan.plan.status === "DRAFT" ? (
            <Button variant="primary" disabled={!isReady || isSubmitting} onClick={() => void runAction(approve)}>
              {t.projectWorkspace.overview.approveAction}
            </Button>
          ) : null}
          {plan.plan.status === "DRAFT" ? (
            <Button variant="secondary" disabled={isSubmitting} onClick={() => void runAction(reject)}>
              {t.projectWorkspace.overview.rejectAction}
            </Button>
          ) : null}
          {plan.plan.status !== "DRAFT" ? (
            <Button variant="secondary" disabled={isSubmitting} onClick={() => void runAction(reopen)}>
              {t.projectWorkspace.overview.reopenAction}
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
