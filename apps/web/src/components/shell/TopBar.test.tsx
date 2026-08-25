// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { UserDto } from "@dyo/schemas";
import { TopBar } from "./TopBar";
import { DashboardStatusProvider } from "../DashboardStatusProvider";
import { ThemeProvider } from "../ThemeProvider";
import { renderWithLocale } from "../../test-utils/render-with-locale";

vi.mock("next/navigation", () => ({ usePathname: () => "/workers" }));

const USER: UserDto = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "OPERATOR",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastLoginAt: null
};

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("dir");
});

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ api: "ok", database: "ok", workers: [], fetchedAt: new Date().toISOString() }) })
  );
}

describe("TopBar", () => {
  it("shows the language switcher and the real page title translated for the active locale", () => {
    stubFetch();
    renderWithLocale(
      <ThemeProvider>
        <DashboardStatusProvider>
          <TopBar onOpenMobileNav={() => {}} user={USER} />
        </DashboardStatusProvider>
      </ThemeProvider>,
      { locale: "he" }
    );

    screen.getByText("עובדים");
    screen.getByRole("button", { name: "English" });
    screen.getByRole("button", { name: "עברית" });
  });

  it("shows the real authenticated user's name and email, never a placeholder", () => {
    stubFetch();
    renderWithLocale(
      <ThemeProvider>
        <DashboardStatusProvider>
          <TopBar onOpenMobileNav={() => {}} user={USER} />
        </DashboardStatusProvider>
      </ThemeProvider>,
      { locale: "en" }
    );

    screen.getByText("Ada Lovelace");
    screen.getByText("ada@example.com");
  });
});
