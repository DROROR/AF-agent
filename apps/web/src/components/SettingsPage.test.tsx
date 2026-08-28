// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserDto } from "@dyo/schemas";
import { SettingsPage } from "./SettingsPage";
import { ThemeProvider } from "./ThemeProvider";
import { LocaleProvider } from "./LocaleProvider";
import { stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

const USER: UserDto = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Test Operator",
  email: "operator@example.com",
  role: "ADMIN",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastLoginAt: null
};

const NOT_CONNECTED = { status: { connected: false, provider: null, model: null, last4: null, lastVerifiedAt: null } };

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderSettings(): void {
  render(
    <ThemeProvider>
      <LocaleProvider>
        <SettingsPage user={USER} />
      </LocaleProvider>
    </ThemeProvider>
  );
}

describe("SettingsPage", () => {
  it("defaults to the AI Providers tab and shows it as the highlighted nav item", async () => {
    stubFetchByUrl({ "/api/settings/ai-provider": { status: 200, body: NOT_CONNECTED } });
    renderSettings();

    expect(screen.getByRole("button", { name: "AI Providers" }).getAttribute("aria-current")).toBe("page");
    await waitFor(() => expect(screen.getByText("Anthropic")).not.toBeNull());
    expect(screen.queryByText("Test Operator")).toBeNull();
  });

  it("switches the visible content when a different nav item is clicked, without navigating pages", async () => {
    stubFetchByUrl({ "/api/settings/ai-provider": { status: 200, body: NOT_CONNECTED } });
    renderSettings();
    await waitFor(() => expect(screen.getByText("Anthropic")).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Account" }));

    expect(screen.getByRole("button", { name: "Account" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Test Operator")).not.toBeNull();
    expect(screen.getByText("operator@example.com")).not.toBeNull();
    expect(screen.queryByText("Anthropic")).toBeNull();
  });

  it("only lists sections that have real content - no placeholder tabs", () => {
    stubFetchByUrl({ "/api/settings/ai-provider": { status: 200, body: NOT_CONNECTED } });
    renderSettings();

    const navLabels = ["AI Providers", "Appearance", "Account", "API / Integrations"];
    for (const label of navLabels) {
      expect(screen.getByRole("button", { name: label })).not.toBeNull();
    }
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });
});
