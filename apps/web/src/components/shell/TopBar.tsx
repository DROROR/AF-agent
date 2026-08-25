"use client";

import { usePathname } from "next/navigation";
import { LogOut, Menu, User } from "lucide-react";
import { useState, type ReactElement } from "react";
import type { UserDto } from "@dyo/schemas";
import { findActiveNavItem } from "../../lib/nav-items";
import { useDashboardStatusContext } from "../DashboardStatusProvider";
import { LanguageToggle } from "../LanguageToggle";
import { useLocale } from "../LocaleProvider";
import { ThemeToggle } from "../ThemeToggle";
import { StatusIndicator } from "../ui/StatusIndicator";
import type { BadgeStatus } from "../StatusBadge";
import type { Dictionary } from "../../lib/i18n/dictionaries";

export interface TopBarProps {
  onOpenMobileNav: () => void;
  user: UserDto;
}

/** Overall connectivity, derived (never fabricated) from the same real snapshot the rest of the app uses - "OK" only once API, DB, and at least one worker are all confirmed reachable/online. */
function overallHealth(status: ReturnType<typeof useDashboardStatusContext>["data"]): BadgeStatus {
  if (!status) {
    return "UNKNOWN";
  }
  if (status.api !== "ok" || status.database === "error") {
    return "ERROR";
  }
  if (status.database === "unknown" || status.workers === null) {
    return "UNKNOWN";
  }
  return "OK";
}

function systemLabel(status: BadgeStatus, t: Dictionary["topbar"]): string {
  switch (status) {
    case "OK":
      return t.systemNormal;
    case "ERROR":
      return t.systemIssue;
    default:
      return t.checking;
  }
}

export function TopBar({ onOpenMobileNav, user }: TopBarProps): ReactElement {
  const pathname = usePathname();
  const active = findActiveNavItem(pathname);
  const { data } = useDashboardStatusContext();
  const { t } = useLocale();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = (): void => {
    setLoggingOut(true);
    // POST first, then a hard navigation - a full page load re-runs
    // middleware, which is what actually enforces the redirect to /login;
    // this never relies on client-side router state alone.
    fetch("/api/auth/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        window.location.href = "/login";
      });
  };

  const health = overallHealth(data);

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button
          type="button"
          className="topbar__icon-button mobile-nav-trigger"
          onClick={onOpenMobileNav}
          aria-label={t.topbar.openNavigation}
        >
          <Menu aria-hidden="true" />
        </button>
        <span className="topbar__title">{active ? t.nav[active.id] : t.topbar.fallbackTitle}</span>
      </div>
      <div className="topbar__actions">
        <StatusIndicator status={health} label={systemLabel(health, t.topbar)} />
        <LanguageToggle />
        <ThemeToggle />
        <div className="topbar__account">
          <span className="topbar__account-avatar">
            <User aria-hidden="true" />
          </span>
          <span className="topbar__account-details">
            <span className="topbar__account-name">
              {user.name}
              {user.role !== "OPERATOR" ? <span className="topbar__account-role">{user.role}</span> : null}
            </span>
            <span className="topbar__account-email">{user.email}</span>
          </span>
          <button
            type="button"
            className="topbar__icon-button"
            onClick={handleLogout}
            disabled={loggingOut}
            aria-label={t.topbar.logout}
            title={t.topbar.logout}
          >
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
