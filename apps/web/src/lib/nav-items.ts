import { FolderKanban, ListTodo, Server, Settings, type LucideIcon } from "lucide-react";

/**
 * 2026-10-21 simplification (operator audit, after the client's first
 * finished videos): the sidebar carried eight entries and the client used
 * two. Overview duplicated the top bar's health line; Jobs / Queue, Workers,
 * Renders listed what the project pages already show; Approvals and
 * Activity had no API behind them. Jobs / Queue and Workers stay: the
 * operator watches the editing computer and the job history there.
 */
export type NavItemId = "projects" | "jobs" | "workers" | "settings";

export interface NavItem {
  href: string;
  /**
   * English label - the fallback/non-translated identifier (also what
   * nav-items.test.ts checks). Components render the translated label via
   * `t.nav[item.id]` (see lib/i18n/dictionaries) instead of this field
   * directly; `label` still exists so a consumer with no locale context
   * has a sane English default.
   */
  label: string;
  id: NavItemId;
  icon: LucideIcon;
}

/** Single source of truth for sidebar nav and the topbar's page-title lookup - see TopBar.tsx. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/projects", label: "Projects", id: "projects", icon: FolderKanban },
  { href: "/jobs", label: "Jobs / Queue", id: "jobs", icon: ListTodo },
  { href: "/workers", label: "Workers", id: "workers", icon: Server },
  { href: "/settings", label: "Settings", id: "settings", icon: Settings }
];

/** Longest-prefix match so a nested route (e.g. /projects/new) still highlights "Projects" and reuses its title. */
export function findActiveNavItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of NAV_ITEMS) {
    const matches = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    if (matches && (!best || item.href.length > best.href.length)) {
      best = item;
    }
  }
  return best;
}
