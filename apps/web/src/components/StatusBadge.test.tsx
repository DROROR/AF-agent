// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";
import { renderWithLocale } from "../test-utils/render-with-locale";

afterEach(cleanup);

describe("StatusBadge", () => {
  it("renders ONLINE as a positive-tone badge", () => {
    renderWithLocale(<StatusBadge status="ONLINE" />);
    const badge = screen.getByText("Online");
    expect(badge.className).toContain("status-badge--positive");
  });

  it("renders OFFLINE as a negative-tone badge", () => {
    renderWithLocale(<StatusBadge status="OFFLINE" />);
    const badge = screen.getByText("Offline");
    expect(badge.className).toContain("status-badge--negative");
  });

  it("renders UNKNOWN as a neutral-tone badge, never as a failure", () => {
    renderWithLocale(<StatusBadge status="UNKNOWN" />);
    const badge = screen.getByText("Unknown");
    expect(badge.className).toContain("status-badge--neutral");
    expect(badge.className).not.toContain("negative");
  });

  it("renders OK and ERROR (system health) with the same positive/negative tones", () => {
    const { unmount } = renderWithLocale(<StatusBadge status="OK" />);
    expect(screen.getByText("OK").className).toContain("status-badge--positive");
    unmount();

    renderWithLocale(<StatusBadge status="ERROR" />);
    expect(screen.getByText("Error").className).toContain("status-badge--negative");
  });

  it("renders the Hebrew label when the active locale is he (translation rendering)", () => {
    renderWithLocale(<StatusBadge status="ONLINE" />, { locale: "he" });
    const badge = screen.getByText("מקוון");
    expect(badge.className).toContain("status-badge--positive");
  });
});
