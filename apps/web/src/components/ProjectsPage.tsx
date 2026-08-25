"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { PageHeader } from "./ui/PageHeader";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";
import { PendingPanel } from "./ui/PendingPanel";

/**
 * No project API exists yet (there is no backend concept of a "project"
 * beyond a job's payload) - this always shows the real empty state,
 * never a fabricated list. See docs/MASTER_PLAN.md for the planned
 * project lifecycle this page will eventually surface.
 */
export function ProjectsPage(): ReactElement {
  const { t } = useLocale();

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
      <Card>
        <EmptyState title={t.projects.emptyTitle} description={t.projects.emptyDescription} />
      </Card>
      <PendingPanel title={t.projects.pendingTitle} description={t.projects.pendingDescription} />
    </>
  );
}
