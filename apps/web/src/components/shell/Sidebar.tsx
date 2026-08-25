"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ReactElement } from "react";
import { BrandLogo } from "../BrandLogo";
import { useLocale } from "../LocaleProvider";
import { NAV_ITEMS, findActiveNavItem } from "../../lib/nav-items";

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate?: () => void;
}

const NOOP = (): void => {};

/**
 * `dir="rtl"` on <html> is enough for the browser to mirror this nav's own
 * flow automatically (flex/grid order, text alignment) via the logical CSS
 * properties in globals.css - no manual per-locale layout branching needed
 * for that. The collapse icon is the one place that genuinely needs to
 * change, not just mirror: in RTL the sidebar itself moves to the opposite
 * physical edge (the near/"start" edge, which is the right side for
 * Hebrew), so "PanelLeftClose/Open" (a picture of a LEFT-side panel) would
 * be pointing at the wrong edge entirely - PanelRightClose/Open is the
 * semantically correct icon there, not a mirror-flip of the LTR one.
 */
export function Sidebar({ collapsed, onToggleCollapsed, onNavigate = NOOP }: SidebarProps): ReactElement {
  const pathname = usePathname();
  const active = findActiveNavItem(pathname);
  const { t, dir } = useLocale();
  const CollapseIcon = dir === "rtl" ? PanelRightClose : PanelLeftClose;
  const ExpandIcon = dir === "rtl" ? PanelRightOpen : PanelLeftOpen;

  return (
    <nav className="sidebar" aria-label={t.sidebar.primaryNavLabel}>
      <Link href="/" className="sidebar__brand" onClick={onNavigate} aria-label={t.sidebar.brandLinkLabel}>
        <span className="sidebar__brand-circle">
          <BrandLogo variant="mark" height={22} priority />
        </span>
        {!collapsed ? <span className="sidebar__brand-name">{t.sidebar.brandName}</span> : null}
      </Link>

      <div className="sidebar__nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = active?.href === item.href;
          const label = t.nav[item.id];
          return (
            <Link
              key={item.href}
              href={item.href}
              className="sidebar__link"
              aria-current={isActive ? "page" : undefined}
              onClick={onNavigate}
              title={collapsed ? label : undefined}
            >
              <Icon aria-hidden="true" />
              <span className="sidebar__link-label">{label}</span>
            </Link>
          );
        })}
      </div>

      <button
        type="button"
        className="sidebar__collapse"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? t.sidebar.expandSidebar : t.sidebar.collapseSidebar}
      >
        {collapsed ? <ExpandIcon aria-hidden="true" /> : <CollapseIcon aria-hidden="true" />}
        {!collapsed ? <span>{t.sidebar.collapse}</span> : null}
      </button>
    </nav>
  );
}
