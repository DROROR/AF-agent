"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { PageHeader } from "./ui/PageHeader";
import { Skeleton } from "./ui/Skeleton";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { PlanStatusBadge } from "./PlanStatusBadge";
import { useLocale } from "./LocaleProvider";
import { useProjectsList, type ProjectListItem } from "../lib/use-projects-list";
import { formatRelativeTime } from "../lib/relative-time";

function ProjectCard({ project }: { project: ProjectListItem }): ReactElement {
  const { t, locale } = useLocale();

  return (
    <Card className="project-card">
      <div className="project-card__header">
        <h3>{project.name}</h3>
        {project.planStatus ? <PlanStatusBadge status={project.planStatus} /> : <span className="project-card__na">—</span>}
      </div>
      <dl className="project-card__facts">
        <div>
          <dt>{t.projects.card.sourceFile}</dt>
          <dd>{project.sourceFileName ?? "—"}</dd>
        </div>
        <div>
          <dt>{t.projects.card.revision}</dt>
          <dd>{project.planRevision ?? "—"}</dd>
        </div>
        <div>
          <dt>{t.projects.card.sourceSha}</dt>
          <dd>
            <code>{project.sourceShaAbbrev ?? "—"}</code>
          </dd>
        </div>
        <div>
          <dt>{t.projects.card.scenes}</dt>
          <dd>{project.sceneCount ?? "—"}</dd>
        </div>
        <div>
          <dt>{t.projects.card.unresolved}</dt>
          <dd>{project.unresolvedCount ?? "—"}</dd>
        </div>
        <div>
          <dt>{t.projects.card.updated}</dt>
          <dd>{formatRelativeTime(new Date(project.updatedAt), new Date(), locale)}</dd>
        </div>
      </dl>
      <Link href={`/projects/${project.projectId}`}>
        <Button variant="primary" size="sm">
          {t.projects.card.open}
        </Button>
      </Link>
    </Card>
  );
}

/**
 * Real Projects list, backed by GET /api/projects (Phase 6) - see
 * lib/use-projects-list.ts. Never renders a fabricated project; a field
 * this dashboard genuinely cannot obtain for a project (e.g. its manifest
 * failed to load) shows "—", not an invented value.
 */
export function ProjectsPage(): ReactElement {
  const { t } = useLocale();
  const { items, isLoading, error } = useProjectsList();

  return (
    <>
      <PageHeader
        title={t.projects.title}
        description={t.projects.description}
        actions={
          <Link href="/projects/new">
            <Button variant="primary">
              <Plus aria-hidden="true" />
              {t.projects.newProject}
            </Button>
          </Link>
        }
      />
      {isLoading ? (
        <Card>
          <Skeleton height="1.5rem" />
        </Card>
      ) : error ? (
        <Card>
          <ErrorState title={t.projects.unavailableTitle} description={error} />
        </Card>
      ) : !items || items.length === 0 ? (
        <Card>
          <EmptyState title={t.projects.emptyTitle} description={t.projects.emptyDescription} />
        </Card>
      ) : (
        <div className="card-grid project-card-grid">
          {items.map((project) => (
            <ProjectCard key={project.projectId} project={project} />
          ))}
        </div>
      )}
    </>
  );
}
