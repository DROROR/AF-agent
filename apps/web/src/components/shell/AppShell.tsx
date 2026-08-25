"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import type { UserDto } from "@dyo/schemas";
import { useLocale } from "../LocaleProvider";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const SIDEBAR_COLLAPSED_KEY = "dyo-sidebar-collapsed";

function readCollapsedPreference(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeCollapsedPreference(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Best-effort only.
  }
}

export interface AppShellProps {
  children: ReactNode;
  user: UserDto;
}

export function AppShell({ children, user }: AppShellProps): ReactElement {
  const { t } = useLocale();
  // Starts false to match the server-rendered HTML exactly (localStorage
  // does not exist during SSR) - then synchronizes to the real persisted
  // preference immediately after mount. A brief "expanded" flash for
  // returning users with a collapsed preference is an accepted, low-stakes
  // trade-off here (unlike the theme, which uses a blocking anti-flash
  // script in layout.tsx specifically because a visible flash there would
  // be much more jarring).
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(readCollapsedPreference());
  }, []);

  const toggleCollapsed = (): void => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsedPreference(next);
      return next;
    });
  };

  return (
    <div className="app-shell" data-sidebar-collapsed={collapsed} data-sidebar-mobile-open={mobileOpen}>
      <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} onNavigate={() => setMobileOpen(false)} />
      {mobileOpen ? (
        <button type="button" className="sidebar-scrim" aria-label={t.sidebar.closeNavigation} onClick={() => setMobileOpen(false)} />
      ) : null}
      <div className="app-content">
        <TopBar onOpenMobileNav={() => setMobileOpen(true)} user={user} />
        <main className="page">{children}</main>
      </div>
    </div>
  );
}
