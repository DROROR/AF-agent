// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

afterEach(cleanup);

describe("StatusBadge", () => {
  it("renders ONLINE as a positive-tone badge", () => {
    render(<StatusBadge status="ONLINE" />);
    const badge = screen.getByText("Online");
    expect(badge.className).toContain("status-badge--positive");
  });

  it("renders OFFLINE as a negative-tone badge", () => {
    render(<StatusBadge status="OFFLINE" />);
    const badge = screen.getByText("Offline");
    expect(badge.className).toContain("status-badge--negative");
  });

  it("renders UNKNOWN as a neutral-tone badge, never as a failure", () => {
    render(<StatusBadge status="UNKNOWN" />);
    const badge = screen.getByText("Unknown");
    expect(badge.className).toContain("status-badge--neutral");
    expect(badge.className).not.toContain("negative");
  });

  it("renders OK and ERROR (system health) with the same positive/negative tones", () => {
    const { unmount } = render(<StatusBadge status="OK" />);
    expect(screen.getByText("OK").className).toContain("status-badge--positive");
    unmount();

    render(<StatusBadge status="ERROR" />);
    expect(screen.getByText("Error").className).toContain("status-badge--negative");
  });
});
