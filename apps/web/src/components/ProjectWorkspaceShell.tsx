"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement, ReactNode } from "react";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { PlanStatusBadge } from "./PlanStatusBadge";
import { ErrorState } from "./ErrorState";
import { Card } from "./ui/Card";
import { Skeleton } from "./ui/Skeleton";
import { useLocale } from "./LocaleProvider";

interface TabDef {
  href: string;
  labelKey: "overview" | "scenes" | "revisions";
}

function tabsFor(projectId: string): TabDef[] {
  return [
    { href: `/projects/${projectId}`, labelKey: "overview" },
    { href: `/projects/${projectId}/scenes`, labelKey: "scenes" },
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
  const { project, plan, isLoading, error } = useProjectWorkspaceContext();

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
        <div>
          <h1>{project.project.name}</h1>
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
        </div>
        {plan ? <PlanStatusBadge status={plan.plan.status} /> : null}
      </div>
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
