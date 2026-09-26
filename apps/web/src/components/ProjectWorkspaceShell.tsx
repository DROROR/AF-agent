"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState, type ReactElement, type ReactNode } from "react";
import { Lock, Trash2 } from "lucide-react";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useProjectGuidance } from "./ProjectGuidanceProvider";
import { useWorkspaceMode } from "./WorkspaceModeProvider";
import { ProjectWorkflowStepper } from "./ProjectWorkflowStepper";
import { ProjectNextActionBanner } from "./ProjectNextActionBanner";
import { PlanStatusBadge } from "./PlanStatusBadge";
import { ErrorState } from "./ErrorState";
import { Card } from "./ui/Card";
import { Skeleton } from "./ui/Skeleton";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { useLocale } from "./LocaleProvider";
import { deleteProject } from "../lib/projects-api-client";
import { SIMPLIFIED_PROJECT_WORKSPACE } from "../lib/feature-flags";

interface TabDef {
  href: string;
  labelKey: "overview" | "scenes" | "assets" | "preview" | "export" | "workMap" | "revisions" | "renderSettings";
}

/**
 * Final MVP nav (client-facing UX redesign, section H, finalized): the
 * normal client-facing nav reads Project / Files / Scenes / Preview /
 * Export - Work Map, Render Settings (raw composition/template fields)
 * and Revisions stay under Advanced (never removed, never deleted - see
 * WorkspaceModeProvider). "overview"/"assets" keep their existing i18n
 * KEY names (only the displayed label text changed to "Project"/"Files" -
 * see dictionaries/en.ts's own tabs.overview/tabs.assets) to avoid an
 * unnecessary key-rename across every locale file; "preview" reuses
 * ProjectPreviewTab (the first-frame + complete-preview approval gates,
 * moved out of the old combined Overview tab) and "export" reuses
 * ProjectExportTab (a plain-language render trigger + the same real
 * download/playback list Advanced's Render Settings tab already showed).
 *
 * 2026-09-26: leaving Render Settings out of this list used to be a real
 * dead end, not just a simplification - a LANDSCAPE master must be saved
 * before Export can render anything, and this list is the reason nobody
 * could reach the form that saves one. The form itself now renders on the
 * Export tab for any output that is missing it, so the five tabs below are
 * genuinely everything the job needs. These three remain Advanced-only for
 * the fuller technical view, and all three URLs still work directly.
 */
function tabsFor(projectId: string, mode: "simple" | "advanced"): TabDef[] {
  const simpleTabs: TabDef[] = [
    { href: `/projects/${projectId}`, labelKey: "overview" },
    { href: `/projects/${projectId}/assets`, labelKey: "assets" },
    { href: `/projects/${projectId}/scenes`, labelKey: "scenes" },
    { href: `/projects/${projectId}/preview`, labelKey: "preview" },
    { href: `/projects/${projectId}/export`, labelKey: "export" }
  ];
  if (mode === "simple") {
    return simpleTabs;
  }
  return [
    ...simpleTabs,
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
export function ProjectWorkspaceShell({
  projectId,
  children
}: {
  projectId: string;
  children: ReactNode;
}): ReactElement {
  const { t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { project, plan, isLoading, error } = useProjectWorkspaceContext();
  const { nextAction, tabLocks, stateUnknown } = useProjectGuidance();
  const { mode, setMode } = useWorkspaceMode();
  const hintIdPrefix = useId();
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
    return (
      <ErrorState
        title={t.projectWorkspace.loadErrorTitle}
        {...(error ? { description: error } : {})}
      />
    );
  }

  const unresolvedCount = plan
    ? plan.plan.scenePlans.filter((scene) => scene.unresolvedReasons.length > 0).length
    : null;
  const tabs = tabsFor(projectId, mode);
  const isProjectFrontPage = pathname === `/projects/${projectId}`;

  return (
    <>
      <Link href="/projects" className="workspace-header__back">
        {t.projectWorkspace.backToProjects}
      </Link>
      {/*
        The top of the page is now the project's name and how its plan
        stands, and nothing else. It previously also carried a Simple/
        Advanced mode switch and a red Delete Project button: a decision
        nobody can make before they know what the app does, sitting next to
        a permanently-armed destructive action, above every single page. Both
        still exist, unchanged, in one disclosure at the foot of the page -
        see the footer block below.
      */}
      <div className="workspace-header">
        <h1>{project.project.name}</h1>
        <div className="workspace-header__actions">
          {plan ? <PlanStatusBadge status={plan.plan.status} /> : null}
          {SIMPLIFIED_PROJECT_WORKSPACE ? null : <ProjectSettingsControls mode={mode} setMode={setMode} onDelete={() => setConfirmingDelete(true)} />}
        </div>
      </div>
      {SIMPLIFIED_PROJECT_WORKSPACE ? null : (
        <details className="advanced-details workspace-header__details">
          <summary>{t.projectWorkspace.header.detailsToggle}</summary>
          <ProjectTechnicalFacts project={project} plan={plan} unresolvedCount={unresolvedCount} />
        </details>
      )}
      <Dialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={t.projectWorkspace.deleteConfirmTitle}
        variant="modal"
      >
        <p>{t.projectWorkspace.deleteConfirmDescription(project.project.name)}</p>
        {deleteError ? (
          <ErrorState title={t.projectWorkspace.deleteFailedTitle} description={deleteError} />
        ) : null}
        <div className="edit-drawer-actions">
          <Button variant="ghost" disabled={isDeleting} onClick={() => setConfirmingDelete(false)}>
            {t.projectWorkspace.deleteCancelAction}
          </Button>
          <Button variant="danger" disabled={isDeleting} onClick={() => void handleConfirmDelete()}>
            <Trash2 aria-hidden="true" />
            {isDeleting
              ? t.projectWorkspace.deletingAction
              : t.projectWorkspace.deleteConfirmAction}
          </Button>
        </div>
      </Dialog>
      {/*
        ONE thing answers "where am I, what now". The seven-chip stepper used
        to sit here as well, directly above the banner, saying the same thing
        in a weaker form - it named a phase, never an action, and its seven
        links were seven more places to guess at. The same seven steps are on
        the project's front page instead (ProjectChecklist), from the same
        derivation, with the current one opened and the button in it; on that
        page the checklist owns the job, so the banner stands down rather
        than repeating it a second time on the same screen.
      */}
      {SIMPLIFIED_PROJECT_WORKSPACE ? null : <ProjectWorkflowStepper />}
      {isProjectFrontPage && SIMPLIFIED_PROJECT_WORKSPACE ? null : <ProjectNextActionBanner projectId={projectId} />}
      {/*
        REAL 2026-09-25 INCIDENT: a tab someone was not allowed to use yet
        looked exactly like one they were. data-locked plus a real, visible
        hint fixes that, from the SAME shared derivation the banner and the
        checklist read (ProjectGuidanceProvider), so the nav can never
        disagree with the page it links to. `tabLockedHint` had been sitting
        unused in every locale dictionary since it was written - nothing
        rendered it - so "locked until X" was a promise the UI never actually
        kept. Locked tabs stay clickable on purpose: the page behind them
        already explains itself, and silently swallowing a click is its own
        unexplained dead end.

        The nav USED TO also mark the next tab (data-next, plus a "Next"
        badge). That was a third element answering a question the stepper and
        the banner were already both answering, and the operator had to read
        and reconcile all three before acting - so SIMPLIFIED_PROJECT_WORKSPACE
        turns it off. The lock stays, because "why can I not use this" is a
        different question and nothing else on screen answers it.

        While the real state is unknown, no marker is drawn at all - marking
        the wrong tab is worse than marking none.
      */}
      <nav className="workspace-tabs" aria-label={t.projectWorkspace.tabs.overview}>
        {tabs.map((tab) => {
          const isLocked = !stateUnknown && (tab.labelKey === "preview" ? tabLocks.preview : tab.labelKey === "export" ? tabLocks.export : false);
          // The tab bar no longer marks the next step itself. The checklist
          // (front page) and the banner (everywhere else) already name the
          // tab AND link to it, so a third marker only added another thing
          // to read for the same fact. Locks stay: "why can I not use this"
          // is a different question, and nothing else on screen answers it.
          const isNext = !SIMPLIFIED_PROJECT_WORKSPACE && !stateUnknown && nextAction.tab === tab.labelKey;
          const lockHint = isLocked ? (tab.labelKey === "preview" ? t.projectWorkspace.tabLockedHint.preview : t.projectWorkspace.tabLockedHint.export) : null;
          const hintId = `${hintIdPrefix}-${tab.labelKey}`;
          const label = t.projectWorkspace.tabs[tab.labelKey];
          return (
            <span key={tab.href} className="workspace-tab-slot">
              <Link
                href={tab.href}
                className="workspace-tab"
                data-active={pathname === tab.href}
                data-next={isNext ? "true" : undefined}
                data-locked={isLocked ? "true" : undefined}
                aria-label={isLocked ? `${label} ${t.projectWorkspace.tabLockedAriaSuffix}` : isNext ? `${label} ${t.projectWorkspace.tabNextAriaSuffix}` : undefined}
                {...(lockHint ? { "aria-describedby": hintId } : {})}
              >
                {label}
                {isLocked ? <Lock aria-hidden="true" size={12} className="workspace-tab__lock" /> : null}
              </Link>
              {/* Outside the <a> on purpose: the badge is decoration, and
                  folding "Next" into the link's own text content would change
                  every tab's accessible name and its textContent. Assistive
                  tech gets the same fact from the link's aria-label instead. */}
              {isNext ? (
                <span className="workspace-tab__next" aria-hidden="true">
                  {t.projectWorkspace.tabNextBadge}
                </span>
              ) : null}
              {lockHint ? (
                <span id={hintId} role="tooltip" className="workspace-tab__hint">
                  {lockHint}
                </span>
              ) : null}
            </span>
          );
        })}
      </nav>
      {children}
      {SIMPLIFIED_PROJECT_WORKSPACE ? (
        // Everything that is not a step on the way to a finished video, in
        // one closed drawer at the very bottom: the engineering facts support
        // asks for, the Advanced view switch, and Delete Project. Nothing was
        // removed - it is out of the way, not gone.
        <details className="advanced-details workspace-footer__details">
          <summary>{t.projectWorkspace.header.settingsDrawerToggle}</summary>
          <ProjectTechnicalFacts project={project} plan={plan} unresolvedCount={unresolvedCount} />
          <div className="workspace-footer__controls">
            <ProjectSettingsControls mode={mode} setMode={setMode} onDelete={() => setConfirmingDelete(true)} />
          </div>
        </details>
      ) : null}
    </>
  );
}

/**
 * The Simple/Advanced switch and Delete Project, kept together because they
 * share one property: neither is a step in making a video. Extracted so the
 * simplified layout can move them to the foot of the page without either the
 * markup or the behaviour being duplicated or re-implemented.
 */
function ProjectSettingsControls({
  mode,
  setMode,
  onDelete
}: {
  mode: "simple" | "advanced";
  setMode: (mode: "simple" | "advanced") => void;
  onDelete: () => void;
}): ReactElement {
  const { t } = useLocale();
  return (
    <>
      <div className="workspace-mode-toggle" role="group" aria-label={t.workspaceMode.toggleAriaLabel}>
        <button type="button" className="workspace-mode-toggle__option" data-active={mode === "simple"} onClick={() => setMode("simple")}>
          {t.workspaceMode.simpleAction}
        </button>
        <button type="button" className="workspace-mode-toggle__option" data-active={mode === "advanced"} onClick={() => setMode("advanced")}>
          {t.workspaceMode.advancedAction}
        </button>
      </div>
      <Button size="sm" variant="danger" onClick={onDelete}>
        <Trash2 aria-hidden="true" />
        {t.projectWorkspace.deleteProjectAction}
      </Button>
    </>
  );
}

/** Source project, hash, revision and scene counts - real values support needs, and that nobody making a video has to read. */
function ProjectTechnicalFacts({
  project,
  plan,
  unresolvedCount
}: {
  project: NonNullable<ReturnType<typeof useProjectWorkspaceContext>["project"]>;
  plan: ReturnType<typeof useProjectWorkspaceContext>["plan"];
  unresolvedCount: number | null;
}): ReactElement {
  const { t } = useLocale();
  return (
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
  );
}
