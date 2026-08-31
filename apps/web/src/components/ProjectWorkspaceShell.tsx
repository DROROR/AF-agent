"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactElement, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { ProjectWorkflowStepper } from "./ProjectWorkflowStepper";
import { PlanStatusBadge } from "./PlanStatusBadge";
import { ErrorState } from "./ErrorState";
import { Card } from "./ui/Card";
import { Skeleton } from "./ui/Skeleton";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { useLocale } from "./LocaleProvider";
import { deleteProject } from "../lib/projects-api-client";

interface TabDef {
  href: string;
  labelKey: "overview" | "scenes" | "assets" | "workMap" | "revisions" | "renderSettings";
}

function tabsFor(projectId: string): TabDef[] {
  return [
    { href: `/projects/${projectId}`, labelKey: "overview" },
    { href: `/projects/${projectId}/scenes`, labelKey: "scenes" },
    { href: `/projects/${projectId}/assets`, labelKey: "assets" },
    { href: `/projects/${projectId}/work-map`, labelKey: "workMap" },
    { href: `/projects/${projectId}/render-settings`, labelKey: "renderSettings" },
    { href: `/projects/${projectId}/revisions`, labelKey: "revisions" }
  ];
}

/**
 * Shared workspace chrome for /projects/:projectId (and its /scenes,
 * /revisions sub-routes) - reads the real project+plan state from
 * ProjectWorkspaceProvider (one shared fetch per project route, not
 * per-tab) and renders the header facts + tab nav required by the
 * dashboard-integration task, using only real API values.
 */
export function ProjectWorkspaceShell({ projectId, children }: { projectId: string; children: ReactNode }): ReactElement {
  const { t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { project, plan, isLoading, error } = useProjectWorkspaceContext();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleConfirmDelete(): Promise<void> {
    setIsDeleting(true);
    setDeleteError(null);
    const result = await deleteProject(projectId);
    setIsDeleting(false);
    if (!result.ok) {
      setDeleteError(result.message ?? null);
      return;
    }
    router.push("/projects");
  }

  if (isLoading) {
    return (
      <Card>
        <Skeleton height="1.5rem" />
      </Card>
    );
  }

  if (error || !project) {
    return <ErrorState title={t.projectWorkspace.loadErrorTitle} {...(error ? { description: error } : {})} />;
  }

  const unresolvedCount = plan ? plan.plan.scenePlans.filter((scene) => scene.unresolvedReasons.length > 0).length : null;
  const tabs = tabsFor(projectId);

  return (
    <>
      <Link href="/projects" className="workspace-header__back">
        {t.projectWorkspace.backToProjects}
      </Link>
      <div className="workspace-header">
        <h1>{project.project.name}</h1>
        <div className="workspace-header__actions">
          {plan ? <PlanStatusBadge status={plan.plan.status} /> : null}
          <Button size="sm" variant="danger" onClick={() => setConfirmingDelete(true)}>
            <Trash2 aria-hidden="true" />
            {t.projectWorkspace.deleteProjectAction}
          </Button>
        </div>
      </div>
      <details className="advanced-details workspace-header__details">
        <summary>{t.projectWorkspace.header.detailsToggle}</summary>
        <p className="workspace-header__facts">
          <span>
            {t.projectWorkspace.header.sourceProject}: <strong>{project.manifest.sourceProject.name}</strong>
          </span>
          <span>
            {t.projectWorkspace.header.sourceSha}: <strong>{project.manifest.sourceProject.sha256.slice(0, 12)}</strong>
          </span>
          {plan ? (
            <>
              <span>
                {t.projectWorkspace.header.revision}: <strong>{plan.plan.revision}</strong>
              </span>
              <span>
                {t.projectWorkspace.header.scenes}: <strong>{plan.plan.scenePlans.length}</strong>
              </span>
              <span>
                {t.projectWorkspace.header.unresolved}: <strong>{unresolvedCount}</strong>
              </span>
            </>
          ) : null}
        </p>
      </details>
      <Dialog open={confirmingDelete} onClose={() => setConfirmingDelete(false)} title={t.projectWorkspace.deleteConfirmTitle} variant="modal">
        <p>{t.projectWorkspace.deleteConfirmDescription(project.project.name)}</p>
        {deleteError ? <ErrorState title={t.projectWorkspace.deleteFailedTitle} description={deleteError} /> : null}
        <div className="edit-drawer-actions">
          <Button variant="ghost" disabled={isDeleting} onClick={() => setConfirmingDelete(false)}>
            {t.projectWorkspace.deleteCancelAction}
          </Button>
          <Button variant="danger" disabled={isDeleting} onClick={() => void handleConfirmDelete()}>
            <Trash2 aria-hidden="true" />
            {isDeleting ? t.projectWorkspace.deletingAction : t.projectWorkspace.deleteConfirmAction}
          </Button>
        </div>
      </Dialog>
      <ProjectWorkflowStepper />
      <nav className="workspace-tabs" aria-label={t.projectWorkspace.tabs.overview}>
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} className="workspace-tab" data-active={pathname === tab.href}>
            {t.projectWorkspace.tabs[tab.labelKey]}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
