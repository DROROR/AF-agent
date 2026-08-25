// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { renderWithLocale } from "../../test-utils/render-with-locale";

vi.mock("next/navigation", () => ({ usePathname: () => "/workers" }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

describe("Sidebar - dashboard navigation in Hebrew and RTL awareness", () => {
  it("renders real English nav labels by default", () => {
    renderWithLocale(<Sidebar collapsed={false} onToggleCollapsed={() => {}} />, { locale: "en" });
    screen.getByText("Overview");
    screen.getByText("Workers");
    screen.getByText("Settings");
  });

  it("renders real Hebrew nav labels when the active locale is he (dashboard navigation in Hebrew)", () => {
    renderWithLocale(<Sidebar collapsed={false} onToggleCollapsed={() => {}} />, { locale: "he" });
    screen.getByText("סקירה כללית");
    screen.getByText("עובדים");
    screen.getByText("הגדרות");
    // The active route (/workers) is still highlighted correctly in Hebrew mode.
    const activeLink = screen.getByText("עובדים").closest("a");
    expect(activeLink?.getAttribute("aria-current")).toBe("page");
  });

  it("uses the RTL-correct collapse icon (PanelRightClose family) once dir=rtl, not a mirror of the LTR one", () => {
    document.documentElement.setAttribute("dir", "rtl");
    const { container } = renderWithLocale(<Sidebar collapsed={false} onToggleCollapsed={() => {}} />, {
      locale: "he"
    });
    const collapseButton = container.querySelector(".sidebar__collapse");
    // lucide-react renders each icon with a stable class name derived from its component name.
    expect(collapseButton?.innerHTML).toContain("panel-right-close");
    expect(collapseButton?.innerHTML).not.toContain("panel-left-close");
  });

  it("uses the LTR collapse icon (PanelLeftClose) when dir=ltr", () => {
    document.documentElement.setAttribute("dir", "ltr");
    const { container } = renderWithLocale(<Sidebar collapsed={false} onToggleCollapsed={() => {}} />, {
      locale: "en"
    });
    const collapseButton = container.querySelector(".sidebar__collapse");
    expect(collapseButton?.innerHTML).toContain("panel-left-close");
  });
});
