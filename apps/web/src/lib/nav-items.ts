import {
  Activity,
  CheckSquare,
  Clapperboard,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  Server,
  Settings,
  type LucideIcon
} from "lucide-react";

export type NavItemId = "overview" | "projects" | "jobs" | "workers" | "approvals" | "renders" | "activity" | "settings";

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
  { href: "/", label: "Overview", id: "overview", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", id: "projects", icon: FolderKanban },
  { href: "/jobs", label: "Jobs / Queue", id: "jobs", icon: ListTodo },
  { href: "/workers", label: "Workers", id: "workers", icon: Server },
  { href: "/approvals", label: "Approvals", id: "approvals", icon: CheckSquare },
  { href: "/renders", label: "Renders", id: "renders", icon: Clapperboard },
  { href: "/activity", label: "Activity / Logs", id: "activity", icon: Activity },
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
