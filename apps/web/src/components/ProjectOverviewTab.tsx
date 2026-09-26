"use client";

import { useState, type ReactElement } from "react";
import { getExecutionPlanReadiness } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { PlanStatusBadge } from "./PlanStatusBadge";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";

/**
 * "Project" tab (final MVP nav, client-facing UX redesign section H,
 * finalized) - the source project facts and the plan approval gate only.
 * Every value here comes from the real project/execution-plan API
 * responses already loaded by ProjectWorkspaceProvider. Approval
 * readiness uses getExecutionPlanReadiness from @dyo/schemas - the SAME
 * shared predicate approve-execution-plan.ts enforces server-side, so
 * this UI can never claim a plan is ready when the backend would
 * actually refuse it (and vice versa). The "Approve plan" button is
 * disabled whenever it isn't ready, with the reason shown - never a
 * silently-disabled button with no explanation - but this is a UX
 * convenience, not the enforcement: a direct API call is independently
 * refused with PRECONDITION_NOT_MET.
 *
 * The scene-execution + first/final-preview approval flow that used to
 * live in this same tab now has its own dedicated "Preview" tab
 * (ProjectPreviewTab.tsx) - this keeps "Project" focused on the plan
 * itself, never mixed with the per-scene execution mechanics.
 *
 * 2026-09-26, SUBTRACTION PASS: all of it now sits inside one closed
 * disclosure, below ProjectChecklist (rendered by this route's page.tsx).
 * Source hashes, revision numbers, mapping counts and a section headed
 * "Safety / execution state" are real and worth keeping, but they are
 * engineering facts - the operator making a video reads none of them, and
 * they were the first thing on the page they landed on. Nothing here was
 * removed or disabled: every control, including Approve plan, is one click
 * away inside the drawer, and still the only place that decision is taken
 * in Advanced view.
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
    // No plan yet: there is nothing to detail and nothing to approve, and
    // ProjectChecklist directly above already says, in words, that creating
    // the plan is the next thing and where to do it. Saying "no execution
    // plan yet" again underneath it is the second voice the operator asked
    // us to remove.
    return null;
  }

  const readiness = getExecutionPlanReadiness(plan.plan.scenePlans);
  const mappingCount = plan.plan.scenePlans.reduce((sum, scene) => sum + scene.mappings.length, 0);
  const isReady = readiness.ready && plan.plan.status === "DRAFT";
  // The blocked reasons are already listed above this button; this states
  // the same truth ON the control, so a screen reader announces it with the
  // button and a hover says it too (REAL 2026-09-25 incident: a disabled
  // button with no explanation attached to it was the worst thing in this
  // UI, even when an explanation existed somewhere else on the page).
  const approveDisabledReason = isSubmitting
    ? t.projectWorkspace.disabledReason.working
    : plan.plan.status !== "DRAFT"
      ? t.projectWorkspace.disabledReason.planNotDraft
      : !readiness.ready
        ? t.projectWorkspace.disabledReason.planNotReady
        : undefined;

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
    <details className="advanced-details project-details-drawer">
      <summary>{t.projectWorkspace.overview.detailsToggle}</summary>
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
              <Button variant="primary" disabled={!isReady || isSubmitting} disabledReason={approveDisabledReason} onClick={() => void runAction(approve)}>
                {t.projectWorkspace.overview.approveAction}
              </Button>
            ) : null}
            {plan.plan.status === "DRAFT" ? (
              <Button variant="secondary" disabled={isSubmitting} disabledReason={t.projectWorkspace.disabledReason.working} onClick={() => void runAction(reject)}>
                {t.projectWorkspace.overview.rejectAction}
              </Button>
            ) : null}
            {plan.plan.status !== "DRAFT" ? (
              <Button variant="secondary" disabled={isSubmitting} disabledReason={t.projectWorkspace.disabledReason.working} onClick={() => void runAction(reopen)}>
                {t.projectWorkspace.overview.reopenAction}
              </Button>
            ) : null}
          </div>
        </Card>
      </div>
    </details>
  );
}
