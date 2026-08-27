"use client";

import { useState, type ReactElement } from "react";
import type { RenderArtifactDto } from "@dyo/schemas";
import { useProjectsList } from "../lib/use-projects-list";
import { useRenderArtifacts } from "../lib/use-render-artifacts";
import { renderArtifactFileUrl } from "../lib/projects-api-client";
import { Card } from "./ui/Card";
import { Field } from "./ui/Field";
import { Select } from "./ui/Select";
import { Skeleton } from "./ui/Skeleton";
import { PageHeader } from "./ui/PageHeader";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Real Renders page (render-delivery phase section 7) - only genuinely
 * persisted, validated render_artifacts rows are ever shown here; there is
 * no placeholder/fake card and no speculative "pending" state for a render
 * that was never actually produced. This is a global nav page (not nested
 * under /projects/:projectId), so it needs its own project selector -
 * reuses useProjectsList (the same data source ProjectsPage.tsx already
 * fetches) rather than inventing a second project-listing endpoint.
 */
export function RendersPage(): ReactElement {
  const { t } = useLocale();
  const { items: projects, isLoading: isLoadingProjects, error: projectsError } = useProjectsList();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  // Derived during render (never via an effect + setState) - defaults to
  // the first real project until the user picks a different one.
  const effectiveProjectId = selectedProjectId ?? projects?.[0]?.projectId ?? null;

  return (
    <>
      <PageHeader title={t.renders.title} description={t.renders.description} />

      <Card>
        {isLoadingProjects ? (
          <Skeleton height="1.5rem" />
        ) : projectsError ? (
          <ErrorState title={t.projectWorkspace.loadErrorTitle} description={projectsError} />
        ) : !projects || projects.length === 0 ? (
          <EmptyState title={t.renders.noProjectsTitle} description={t.renders.noProjectsDescription} />
        ) : (
          <>
            <Field label={t.renders.projectSelectorLabel} htmlFor="renders-project-select">
              <Select
                id="renders-project-select"
                value={effectiveProjectId ?? ""}
                onChange={(event) => setSelectedProjectId(event.target.value)}
              >
                {projects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>
            {effectiveProjectId ? <ProjectRenderArtifacts key={effectiveProjectId} projectId={effectiveProjectId} /> : null}
          </>
        )}
      </Card>
    </>
  );
}

function ProjectRenderArtifacts({ projectId }: { projectId: string }): ReactElement {
  const { t } = useLocale();
  const { artifacts, isLoading, error } = useRenderArtifacts(projectId);

  if (isLoading) {
    return <Skeleton height="1.5rem" />;
  }
  if (error) {
    return <ErrorState title={t.renders.loadErrorTitle} description={error} />;
  }
  if (!artifacts || artifacts.length === 0) {
    return <EmptyState title={t.renders.emptyTitle} description={t.renders.emptyDescription} />;
  }

  return (
    <div className="table-scroll">
      <table>
        <caption className="visually-hidden">{t.renders.title}</caption>
        <thead>
          <tr>
            <th scope="col">{t.renders.variantColumn}</th>
            <th scope="col">{t.renders.compositionColumn}</th>
            <th scope="col">{t.renders.statusColumn}</th>
            <th scope="col">{t.renders.completedColumn}</th>
            <th scope="col">{t.renders.sizeColumn}</th>
            <th scope="col">
              <span className="visually-hidden">{t.renders.downloadAction}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {artifacts.map((artifact) => (
            <RenderArtifactRow key={artifact.id} projectId={projectId} artifact={artifact} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RenderArtifactRow({ projectId, artifact }: { projectId: string; artifact: RenderArtifactDto }): ReactElement {
  const { t } = useLocale();
  return (
    <tr>
      <td>{t.renders.variantLabel[artifact.variant]}</td>
      <td>{artifact.compositionName}</td>
      <td>{t.renders.statusReady}</td>
      <td>{new Date(artifact.renderCompletedAt).toLocaleString()}</td>
      <td>{formatBytes(artifact.byteSize)}</td>
      <td>
        <a className="btn btn--secondary btn--sm" href={renderArtifactFileUrl(projectId, artifact.id)}>
          {t.renders.downloadAction}
        </a>
      </td>
    </tr>
  );
}
