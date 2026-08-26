"use client";

import type { ReactElement } from "react";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { PlanStatusBadge } from "./PlanStatusBadge";
import { Card, CardHeader } from "./ui/Card";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { Skeleton } from "./ui/Skeleton";
import { useLocale } from "./LocaleProvider";
import { useExecutionPlanRevisions } from "../lib/use-execution-plan-revisions";

export function ProjectRevisionsTab(): ReactElement | null {
  const { project } = useProjectWorkspaceContext();

  if (!project) {
    return null;
  }

  return <RevisionsTable projectId={project.project.projectId} />;
}

function RevisionsTable({ projectId }: { projectId: string }): ReactElement {
  const { t } = useLocale();
  const { revisions, isLoading, error } = useExecutionPlanRevisions(projectId);

  return (
    <Card>
      <CardHeader title={t.projectWorkspace.revisions.title} />
      <p>{t.projectWorkspace.revisions.description}</p>
      {isLoading ? (
        <Skeleton height="1.5rem" />
      ) : error ? (
        <ErrorState title={t.projectWorkspace.loadErrorTitle} description={error} />
      ) : !revisions || revisions.length === 0 ? (
        <EmptyState title={t.projectWorkspace.revisions.emptyTitle} description={t.projectWorkspace.revisions.emptyDescription} />
      ) : (
        <div className="table-scroll">
          <table className="revisions-table">
            <caption className="visually-hidden">{t.projectWorkspace.revisions.tableCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{t.projectWorkspace.revisions.revisionColumn}</th>
                <th scope="col">{t.projectWorkspace.revisions.statusColumn}</th>
                <th scope="col">{t.projectWorkspace.revisions.scenesColumn}</th>
                <th scope="col">{t.projectWorkspace.revisions.approvedColumn}</th>
                <th scope="col">{t.projectWorkspace.revisions.updatedColumn}</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((revision) => (
                <tr key={revision.revision}>
                  <td>
                    {revision.revision}
                    {revision.isCurrent ? <span className="revision-current-badge">{t.projectWorkspace.revisions.currentBadge}</span> : null}
                  </td>
                  <td>
                    <PlanStatusBadge status={revision.status} />
                  </td>
                  <td>{revision.sceneCount}</td>
                  <td>{revision.approvedAt ? new Date(revision.approvedAt).toLocaleString() : "—"}</td>
                  <td>{new Date(revision.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
